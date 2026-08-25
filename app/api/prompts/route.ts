import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { addPrompt, listPrompts } from "@/lib/firestore-server";

export async function GET(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const prompts = await listPrompts();
    return NextResponse.json({ prompts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompts" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const prompt = await addPrompt(body?.prompt);
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save prompt" },
      { status: 400 }
    );
  }
}
