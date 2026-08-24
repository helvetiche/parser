import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { addRole, listRoles } from "@/lib/firestore-server";

export async function GET(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const roles = await listRoles();
    return NextResponse.json({ roles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load roles" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const role = await addRole(body?.role);
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save role" },
      { status: 500 }
    );
  }
}
