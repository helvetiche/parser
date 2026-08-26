import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  removeRole,
  removeRoleEndorsement,
  saveRoleEndorsement,
} from "@/lib/firestore-server";
import type { Endorsement, EndorsementStatus } from "@/lib/role-schema";

const VALID_STATUS: EndorsementStatus[] = ["endorsed", "interviewed", "hired", "rejected"];

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

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/roles/[id]">) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    const body = await req.json().catch(() => ({}));

    // Upsert a submitted candidate (endorsement) on the role.
    if (body?.endorsement && typeof body.endorsement === "object") {
      const e = body.endorsement as Record<string, unknown>;
      const candidateId = typeof e.candidateId === "string" ? e.candidateId : "";
      const candidateName = typeof e.candidateName === "string" ? e.candidateName : "";
      const status = e.status as EndorsementStatus;
      if (!candidateId || !candidateName || !VALID_STATUS.includes(status)) {
        return NextResponse.json(
          { error: "candidateId, candidateName and a valid status are required" },
          { status: 400 }
        );
      }
      const endorsement: Endorsement = {
        candidateId,
        candidateName,
        status,
        addedAt:
          typeof e.addedAt === "string" && e.addedAt
            ? e.addedAt
            : new Date().toISOString(),
      };
      await saveRoleEndorsement(id, endorsement);
      return NextResponse.json({ endorsement });
    }

    // Remove a submitted candidate from the role.
    if (typeof body?.removeEndorsement === "string" && body.removeEndorsement) {
      await removeRoleEndorsement(id, body.removeEndorsement);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "No endorsement action provided" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update role" },
      { status: 500 }
    );
  }
}
