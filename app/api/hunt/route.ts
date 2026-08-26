import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  extractCandidateProfile,
  focusBrowserTab,
  listBrowserTabs,
  scrapeCandidates,
} from "@/lib/hunt/automation";
import { listRoles } from "@/lib/firestore-server";
import { DEFAULT_MATCH_INSTRUCTIONS, matchCandidateToRole } from "@/lib/match-role";
import type { Candidate } from "@/lib/candidate-schema";

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));

    // Step 1 of the automation: focus a chosen sourcing tab.
    if (typeof body?.open === "string" && body.open) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await focusBrowserTab(body.open, endpoint);
      return NextResponse.json(result);
    }

    // Step 2 of the automation: scrape candidate names + links.
    if (typeof body?.scrape === "string" && body.scrape) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await scrapeCandidates(body.scrape, endpoint);
      return NextResponse.json(result);
    }

    // Step 3 of the automation: open a candidate and extract their profile.
    if (typeof body?.extract === "string" && body.extract) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await extractCandidateProfile(body.extract, endpoint);
      return NextResponse.json(result);
    }

    // Step 5 of the automation: match a (local) parsed candidate to a stored
    // job description. The candidate is NOT written to the DB — only the
    // computed MatchResult is returned.
    if (body?.match && typeof body.match === "object") {
      const { candidate, roleId } = body.match as { candidate?: unknown; roleId?: string };
      if (!candidate || !roleId) {
        return NextResponse.json({ error: "candidate and roleId are required" }, { status: 400 });
      }
      const roles = await listRoles();
      const role = roles.find((r) => r.id === roleId);
      if (!role) {
        return NextResponse.json({ error: "Role not found" }, { status: 404 });
      }
      const match = await matchCandidateToRole(
        candidate as Candidate,
        role,
        undefined,
        DEFAULT_MATCH_INSTRUCTIONS
      );
      return NextResponse.json({ match });
    }

    // Default: list the user's sourcing tabs.
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
    const result = await listBrowserTabs(endpoint);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunt automation failed" },
      { status: 500 }
    );
  }
}
