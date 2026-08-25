import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { removePrompt, updatePrompt } from "@/lib/firestore-server";

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/prompts/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = await req.json();
    await updatePrompt(id, body?.prompt);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update prompt" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/prompts/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    await removePrompt(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
