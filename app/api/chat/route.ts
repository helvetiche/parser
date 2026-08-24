import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/chat";

export async function POST(req: NextRequest) {
  try {
    const { messages, model } = await req.json();
    const response = await chat(messages, model);
    return NextResponse.json({ result: response });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
