import { NextRequest, NextResponse } from "next/server";
import { extractRole, ROLE_MODEL } from "@/lib/extract-role";
import { isReadableText } from "@/lib/text-quality";
import { requireUser } from "@/lib/auth-server";

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const { text, model } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing PDF text" }, { status: 400 });
    }

    const selectedModel = typeof model === "string" && model.trim() ? model : ROLE_MODEL;

    if (!isReadableText(text)) {
      return NextResponse.json(
        {
          error:
            "The document contains no machine-readable text — it may be scanned, image-based, or corrupted. Try a different PDF.",
        },
        { status: 422 }
      );
    }

    const role = await extractRole(text, selectedModel);
    return NextResponse.json({ role });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
