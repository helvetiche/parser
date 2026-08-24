import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { addCandidate, listCandidates } from "@/lib/firestore-server";

export async function GET(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const candidates = await listCandidates();
    return NextResponse.json({ candidates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load candidates" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const candidate = await addCandidate(body?.candidate);
    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save candidate" },
      { status: 500 }
    );
  }
}
