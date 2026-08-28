import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { removeCandidate, updateCandidate } from "@/lib/firestore-server";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/candidates/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    await removeCandidate(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete candidate" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/candidates/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    const body = await req.json().catch(() => ({}));
    const payload = body?.candidate ?? body;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Missing candidate data" }, { status: 400 });
    }
    const candidate = await updateCandidate(id, payload);
    return NextResponse.json({ candidate });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update candidate";
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
