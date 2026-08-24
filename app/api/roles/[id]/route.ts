import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { removeRole } from "@/lib/firestore-server";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/roles/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    await removeRole(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete role" },
      { status: 500 }
    );
  }
}
