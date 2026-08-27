import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  extractCandidateProfile,
  focusBrowserTab,
  goToNextPage,
  listBrowserTabs,
  returnToScrapePage,
  scrapeCandidates,
  scrapeSinglePage,
} from "@/lib/hunt/automation";
import { listRoles } from "@/lib/firestore-server";
import { DEFAULT_MATCH_INSTRUCTIONS, matchCandidateToRole } from "@/lib/match-role";
import type { Candidate } from "@/lib/candidate-schema";

export async function POST(req: NextRequest) {
  const [, denied] = await requireUser(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));

    // STEP 1 — Open tab (bring chosen sourcing tab to foreground).
    if (typeof body?.open === "string" && body.open) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await focusBrowserTab(body.open, endpoint);
      return NextResponse.json(result);
    }

    // STEP 2 — Scrape all candidate names + pagination (legacy fused).
    // Accepts optional maxPages (1..50) and maxCandidates (1..500) to bound traversal.
    if (typeof body?.scrape === "string" && body.scrape) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const maxPages =
        typeof body?.maxPages === "number" && Number.isFinite(body.maxPages)
          ? Math.max(1, Math.min(Math.floor(body.maxPages), 50))
          : undefined;
      const maxCandidates =
        typeof body?.maxCandidates === "number" && Number.isFinite(body.maxCandidates)
          ? Math.max(1, Math.min(Math.floor(body.maxCandidates), 500))
          : undefined;
      const opts: { maxPages?: number; maxCandidates?: number } = {};
      if (maxPages !== undefined) opts.maxPages = maxPages;
      if (maxCandidates !== undefined) opts.maxCandidates = maxCandidates;
      const result = await scrapeCandidates(body.scrape, endpoint, opts);
      return NextResponse.json(result);
    }

    // STEP 2 — Explicit single-page scrape: get ALL candidate URLs for the whole page
    // (no pagination). Used in the new 3-step loop: 1) scrape page → 2) paginate → 3) loop.
    if (typeof body?.scrapePage === "string" && body.scrapePage) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const maxPerPage =
        typeof body?.maxPerPage === "number" && Number.isFinite(body.maxPerPage)
          ? Math.max(1, Math.min(Math.floor(body.maxPerPage), 500))
          : typeof body?.maxCandidates === "number" && Number.isFinite(body.maxCandidates)
            ? Math.max(1, Math.min(Math.floor(body.maxCandidates), 500))
            : undefined;
      const result = await scrapeSinglePage(body.scrapePage, endpoint, maxPerPage ?? 25);
      return NextResponse.json(result);
    }

    // STEP 3 — Scrap pagination (new): move to next page when Step 2 is done.
    // Returns {moved, hasMore} so the orchestrator can loop until limit reached.
    if (typeof body?.nextPage === "string" && body.nextPage) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await goToNextPage(body.nextPage, endpoint);
      return NextResponse.json(result);
    }

    // STEPS 3-5 — Open each candidate's profile → scrape them → close it.
    // Strict lifecycle: a dedicated background tab is created, navigated,
    // scraped, then guaranteed closed before the next candidate is processed.
    // The route is called once per candidate; batching + close guarantees are
    // enforced server-side in extractCandidateProfile (lib/hunt/automation.ts:extractCandidateProfile).
    if (typeof body?.extract === "string" && body.extract) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await extractCandidateProfile(body.extract, endpoint);
      return NextResponse.json(result);
    }

    // Post-STEP 7 — Return to the original scrap candidate page (search/project).
    // Called after matching completes; navigates the sourcing tab back to the
    // initial list URL so the recruiter isn't left on the last pagination page.
    // Respects the pages slider: if 3 pages were scraped, we still return to page 1.
    if (typeof body?.returnToScrape === "string" && body.returnToScrape) {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
      const result = await returnToScrapePage(body.returnToScrape, endpoint);
      return NextResponse.json(result);
    }

    // STEP 7 — Match a (local) parsed candidate to a stored job description.
    // Batch match runs *after* STEP 6 (AI parse of all raws) completes, so
    // no scraping state is held during LLM calls. The candidate is NOT written
    // to the DB — only the computed MatchResult is returned.
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
