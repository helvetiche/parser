import { NextRequest, NextResponse } from "next/server";
import { extractCandidate, PARSER_MODEL } from "@/lib/extract-candidate";
import { isReadableText } from "@/lib/text-quality";

export async function POST(req: NextRequest) {
  try {
    const { text, model } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing PDF text" }, { status: 400 });
    }

    const selectedModel = typeof model === "string" && model.trim() ? model : PARSER_MODEL;

    if (!isReadableText(text)) {
      return NextResponse.json(
        {
          error:
            "The document contains no machine-readable text — it may be scanned, image-based, or corrupted. Try a different PDF.",
        },
        { status: 422 }
      );
    }

    const candidate = await extractCandidate(text, selectedModel);
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
