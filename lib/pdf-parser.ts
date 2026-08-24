import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

import { isReadableText, textQualityScore } from "./text-quality";

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Try strategies best-first; stop as soon as one yields readable text.
  const strategies: Array<[string, () => Promise<string>]> = [
    ["pdfjs", () => extractWithPdfJs(buffer)],
    ["pdf-parse", () => extractWithPdfParse(buffer)],
    ["raw", async () => rawExtract(buffer)],
  ];

  let best = "";

  for (const [name, run] of strategies) {
    try {
      const text = await run();
      if (isReadableText(text)) {
        return text;
      }
      if (textQualityScore(text) > textQualityScore(best)) {
        best = text;
      }
    } catch (err) {
      console.warn(
        `[pdf-parser] strategy ${name} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (!best.trim() || !isReadableText(best)) {
    throw new Error(
      "No machine-readable text found in this PDF — it may be scanned, image-based, or use non-standard fonts."
    );
  }

  return best;
}

async function extractWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trim());

    pages.push(lines.join("\n"));
    page.cleanup();
  }

  await doc.destroy();
  return pages.join("\n\n");
}

async function extractWithPdfParse(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text || "";
}

const ESCAPE_MAP: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

function rawExtract(buffer: Buffer): string {
  const text = buffer.toString("latin1");
  const matches = text.match(/\(((?:\\.|[^()\\])*)\)/g) ?? [];

  const parts = matches
    .map((m) => m.slice(1, -1))
    .map((s) => s.replace(/\\([nrtbf()\\])/g, (_m, c: string) => ESCAPE_MAP[c] ?? c))
    .map((s) => s.replace(/\\[0-7]{1,3}/g, (oct) => String.fromCharCode(parseInt(oct.slice(1), 8))))
    // Strip XML/markup fragments (XMP metadata blocks) that leak into
    // raw byte scrapes and produce endless "</</</" lines.
    .map((s) => s.replace(/<[^>]*>/g, " "))
    .filter((s) => {
      if (!s || s.length > 300) return false;
      const letters = (s.match(/[A-Za-z]/g) ?? []).length;
      return /[A-Za-z]{3}/.test(s) && letters / s.length >= 0.45;
    })
    .map((s) => s.replace(/\s+/g, " ").trim());

  return parts.join("\n");
}
