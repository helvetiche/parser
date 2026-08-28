import { NextRequest, NextResponse } from "next/server";
import { chatWithUsage } from "@/lib/chat";
import { requireUser } from "@/lib/auth-server";

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const { messages, model, context } = await req.json();
    const { result, usage, model: usedModel } = await chatWithUsage(messages, model, context);
    return NextResponse.json({ result, usage, model: usedModel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
