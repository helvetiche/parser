import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserTab = {
  index: number;
  url: string;
  title: string;
  incognito: boolean;
};

export type BrowserTabsResult = {
  endpoint: string;
  tabs: BrowserTab[];
};

const DEFAULT_CDP = "http://127.0.0.1:9222";
const TITLE_TIMEOUT_MS = 1500;

/** Command to launch Chrome with the DevTools port open (copy/paste into Terminal). */
const CHROME_LAUNCH_CMD =
  '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222';

/** Error shown when no browser is listening on the CDP endpoint. */
function browserUnreachableError(endpoint: string): Error {
  return new Error(
    `Could not reach a browser at ${endpoint}.\n\n` +
      `Start Chrome with remote debugging enabled, then reload this tab. ` +
      `Run this in Terminal:\n\n` +
      `  ${CHROME_LAUNCH_CMD}\n`
  );
}

/** Sourcing platforms whose tabs we care about for hunting. */
const SOURCING_HOSTS = ["linkedin.com", "jobstreet.com"];

/** True when the tab's URL belongs to a recognised sourcing platform. */
function isSourcingTab(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SOURCING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Resolves with `fallback` instead of hanging on a slow/unloaded tab. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Connects to the user's ALREADY RUNNING Chromium-based browser (started with
 * `--remote-debugging-port=9222`, e.g. Chrome) over the Chrome DevTools
 * Protocol and lists every open tab across all windows/contexts.
 *
 * NOTE: we intentionally do NOT call `browser.close()` afterwards — closing a
 * CDP-connected browser terminates the user's real browser process. The
 * connection is left open and garbage-collected by the runtime.
 */
export async function listBrowserTabs(endpoint: string = DEFAULT_CDP): Promise<BrowserTabsResult> {
  let browser: Browser;
  try {
    // Bound the connect step so an unreachable endpoint fails fast.
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }

  try {
    const pages: { page: Page; incognito: boolean }[] = [];
    const contexts: BrowserContext[] = browser.contexts();
    for (let c = 0; c < contexts.length; c++) {
      // contexts()[0] is the default profile; any extra ones are incognito.
      const incognito = c > 0;
      for (const page of contexts[c].pages()) {
        pages.push({ page, incognito });
      }
    }

    // Fetch every tab's title concurrently (with a per-tab timeout) instead of
    // awaiting them one-by-one, so total time is bounded by the slowest tab.
    const allTabs: BrowserTab[] = await Promise.all(
      pages.map(async ({ page, incognito }, i) => ({
        index: i + 1,
        url: page.url(),
        title: await withTimeout(page.title().catch(() => ""), TITLE_TIMEOUT_MS, ""),
        incognito,
      }))
    );

    // Keep only sourcing-platform tabs (LinkedIn / JobStreet); exclude everything else.
    const tabs = allTabs.filter((tab) => isSourcingTab(tab.url));

    return { endpoint, tabs };
  } finally {
    // For a CDP-connected browser, close() only drops the WebSocket transport
    // (see _connectOverCDPImpl's onClose), so the user's Chrome keeps running.
    void browser.close().catch(() => {});
  }
}

export type FocusTabResult = {
  ok: boolean;
  title: string;
  url: string;
};

/**
 * STEP 1 — Open tab.
 * Brings the already-open tab matching `targetUrl` to the foreground in the
 * user's browser. This is the user-selected sourcing tab (e.g. LinkedIn
 * Recruiter search/project or JobStreet listing) that STEP 2 will scrape.
 */
export async function focusBrowserTab(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<FocusTabResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }

  try {
    const contexts: BrowserContext[] = browser.contexts();
    for (const context of contexts) {
      for (const page of context.pages()) {
        if (page.url() === targetUrl) {
          await page.bringToFront();
          const title = await withTimeout(page.title().catch(() => ""), TITLE_TIMEOUT_MS, "");
          return { ok: true, title, url: targetUrl };
        }
      }
    }
    throw new Error("Selected tab is no longer open in the browser.");
  } finally {
    void browser.close().catch(() => {});
  }
}

export type ScrapedCandidate = {
  name: string;
  url: string;
};

export type ScrapeCandidatesResult = {
  count: number;
  candidates: ScrapedCandidate[];
  debug: {
    matchedUrl: string | null;
    totalAnchors: number;
    inAnchors: number;
    pagesScraped: number;
    hasMorePages: boolean;
  };
};

export type ScrapeCandidatesOptions = {
  maxPages?: number;
  maxCandidates?: number;
};

/**
 * STEP 2 — Scrape all candidate names + pagination.
 *
 * On the chosen sourcing tab:
 *   1. Exhaustively scroll the current page until the candidate anchor count
 *      stabilises (covers LinkedIn's lazy Virtualized list + JobStreet infinite
 *      scroll).
 *   2. Extract & deduplicate profile URLs (`/in/`, `/talent/profile/`,
 *      `/recruiter/profile/` for LinkedIn; generic anchors for JobStreet).
 *   3. Slice to `maxCandidates` **per page** (slider is per-page, pages is the
 *      multiplier → total = perPage * pages). Unlimited per-page (≥500) means no slice.
 *   4. Detect and click a "Next" pagination control, wait for the next page to
 *      hydrate, then repeat from (1). Accumulates candidates across pages into
 *      a single de-duplicated set before returning. Stops when no enabled
 *      Next button is found or `maxPages` is reached.
 *
 * Looping rule: if current page has 0 candidates OR per-page limit reached,
 * still advance to next page if `maxPages` not exhausted and a Next control
 * exists — avoids stopping on sparse pages.
 *
 * This satisfies "scrape all the candidate names, and paginations" before any
 * profile is opened — steps 3-5 operate on the full list returned here.
 */
export async function scrapeCandidates(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP,
  options: ScrapeCandidatesOptions = {}
): Promise<ScrapeCandidatesResult> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 10, 50));
  // Slider is PER PAGE — pages is multiplier. Unlimited per-page is backend cap 500.
  const maxPerPage = Math.max(1, Math.min(options.maxCandidates ?? 25, 500));

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }

  try {
    // Prefer an exact URL match; fall back to any sourcing tab so a slightly
    // changed URL (tracking params, hash) still resolves to the right page.
    let page: Page | null = null;
    let matchedUrl: string | null = null;
    const contexts: BrowserContext[] = browser.contexts();
    for (const context of contexts) {
      for (const p of context.pages()) {
        if (p.url() === targetUrl) {
          page = p;
          break;
        }
      }
      if (page) break;
    }
    if (!page) {
      // Fallback: prefer a *meaningful* LinkedIn tab (a project/solution/profile
      // page) over the bare Talent home, which would otherwise be grabbed first.
      const meaningful = (u: string) => {
        try {
          const path = new URL(u).pathname.replace(/\/$/, "");
          return /\/(talent|recruiter)/i.test(path) && !/(talent|recruiter)\/?$/i.test(path);
        } catch {
          return false;
        }
      };
      let fallback: Page | null = null;
      for (const context of contexts) {
        for (const p of context.pages()) {
          if (p.url().includes("linkedin.com") || p.url().includes("jobstreet.com")) {
            if (meaningful(p.url())) {
              page = p;
              break;
            }
            fallback ??= p;
          }
        }
        if (page) break;
      }
      page ??= fallback;
    }
    if (!page) throw new Error("Selected tab is no longer open in the browser.");
    matchedUrl = page.url();

    // Ensure the sourcing tab is foreground for reliable pagination clicks.
    await page.bringToFront().catch(() => {});

    // Detect a Recruiter surface — its DOM lacks the legacy `ol.profile-list`
    // and its profile links use `/talent/` rather than `/in/`. We scrape both
    // shapes with one pass so neither path returns zero candidates silently.
    const isRecruiter =
      (await page.$("ol.profile-list")) !== null ||
      /linkedin\.com\/recruiter/i.test(matchedUrl) ||
      (await page.$('a[href*="/talent/profile/"], a[href*="/recruiter/profile/"]')) !== null;

    // Accumulate across paginated pages.
    const seenUrls = new Set<string>();
    const aggregated: ScrapedCandidate[] = [];
    let lastTotalAnchors = 0;
    let lastInAnchors = 0;
    let pagesScraped = 0;
    let hasMorePages = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      // Scroll + extract for the current pagination page.
      const data = await page.evaluate(async (recruiter: boolean) => {
        // Scroll to lazy-load every candidate (mirrors AutoRecruiter).
        const scroller =
          (document.querySelector("ol.profile-list")?.parentElement as HTMLElement) ||
          (document.querySelector(".scaffold-finite-scroll") as HTMLElement | null) ||
          document.scrollingElement;
        const sel = 'a[href*="/in/"], a[href*="/talent/profile/"], a[href*="/recruiter/profile/"]';
        let last = 0;
        let stable = 0;
        for (let i = 0; i < 40; i++) {
          if (scroller) (scroller as HTMLElement).scrollTop = (scroller as HTMLElement).scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise((r) => setTimeout(r, 400));
          const n = document.querySelectorAll(sel).length;
          if (n === last) {
            if (++stable >= 3) break;
          } else {
            stable = 0;
          }
          last = n;
        }

        const all = Array.from(document.querySelectorAll<HTMLAnchorElement>(sel));
        const seen = new Set<string>();
        const out: { name: string; url: string }[] = [];

        for (const a of all) {
          const match = a.href.match(
            /https?:\/\/(www\.)?linkedin\.com\/(?:in|talent\/profile|recruiter\/profile)\/[^\?#]+/i
          );
          if (!match) continue;
          const url = match[0];
          // Skip the Recruiter home / search root — those are not candidate profiles.
          if (/\/(recruiter|talent)\/?($|\?|#)/i.test(url)) continue;
          if (seen.has(url)) continue;
          seen.add(url);

          // Name hunt: aria-label → visible text → nearest labelled parent.
          // Recruiter cards often expose "View profile for <Name>" in aria-label.
          let name = (a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
          name = name.replace(/^View\s+profile\s+for\s+/i, "").trim();
          if (!name) name = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim();
          if (!name) {
            const parent =
              a.closest('[class*="name" i], [class*="title" i]') ?? a.parentElement;
            name = parent ? (parent.textContent || "").replace(/\s+/g, " ").trim() : "";
          }
          if (!name) name = url;
          out.push({ name, url });
        }

        // When we believe we're on Recruiter but found nothing via anchors, also
        // try the legacy project-list rows so older Recruiter builds still work.
        if (recruiter && out.length === 0) {
          for (const li of Array.from(document.querySelectorAll("ol.profile-list > li"))) {
            const label =
              li.querySelector(".profile-list-item__selector .a11y-text")?.textContent?.trim() ||
              "";
            const name = label.replace(/^Select\s+/i, "").trim();
            const link = li.querySelector(
              '.standard-profile-row a[href*="/talent/profile/"], .standard-profile-row a[href*="/recruiter/profile/"], .standard-profile-row a[href*="/in/"]'
            ) as HTMLAnchorElement | null;
            if (name && link?.href) out.push({ name, url: link.href });
          }
        }

        // JobStreet / generic fallback: if no LinkedIn anchors matched, try to
        // harvest any candidate-looking anchors so the pagination loop still
        // exercises on that surface. Keep this minimal to avoid noise.
        if (out.length === 0) {
          const genericSel = 'a[href*="/profile"], a[href*="/candidate"], a[href*="/resume"]';
          const generic = Array.from(document.querySelectorAll<HTMLAnchorElement>(genericSel));
          for (const a of generic) {
            const url = a.href.split("?")[0].split("#")[0];
            if (!url || seen.has(url)) continue;
            seen.add(url);
            const name = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim() || url;
            out.push({ name, url });
          }
        }

        return {
          candidates: out,
          totalAnchors: document.querySelectorAll("a").length,
          inAnchors: all.length,
        };
      }, isRecruiter);

      lastTotalAnchors = data.totalAnchors;
      lastInAnchors = data.inAnchors;
      pagesScraped++;

      // --- User proposal: 1) get ALL candidate URLs for the whole page ---
      // Enforce PER-PAGE limit — pages is multiplier (total = perPage * pages)
      // e.g. 5 per page × 3 pages = 15 total. Unlimited per-page (≥500) = no slice.
      const perPageSlice =
        maxPerPage >= 500 ? data.candidates : data.candidates.slice(0, maxPerPage);
      for (const c of perPageSlice) {
        if (!seenUrls.has(c.url)) {
          seenUrls.add(c.url);
          aggregated.push(c);
        }
      }

      // --- 3) loop until limit is reached ---
      // Total limit = perPage * pages (when both finite). If aggregated has hit
      // total, stop — limit reached. Empty page or per-page limit hit does NOT
      // stop early; we still try next page (see below).
      const isUnlimitedTotal = maxPerPage >= 500 || maxPages >= 50;
      const totalLimit = isUnlimitedTotal ? Infinity : maxPerPage * maxPages;
      if (aggregated.length >= totalLimit) {
        hasMorePages = true; // hit limit, more may exist beyond cap
        break;
      }
      // Even if current page empty (0) or per-page limit reached, we still
      // advance to next page if one exists — don't abort on sparse pages.

      // --- 2) move to the next page and do step 1 again ---
      // Pagination detection — robust: scroll pagination into view first,
      // then look for enabled "Next" via aria-label, text, and known selectors.
      // Covers LinkedIn Recruiter/Talent, LinkedIn.com, and JobStreet variants.
      // Ensures looping even when current page is empty or per-page limit hit,
      // as per user proposal step 2.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(600);
      // Also scroll any pagination container into view
      await page
        .evaluate(() => {
          const pag = document.querySelector(
            '.artdeco-pagination, .pagination, [data-test-pagination], nav[aria-label*="pagination" i]'
          ) as HTMLElement | null;
          if (pag) pag.scrollIntoView({ block: "center" });
        })
        .catch(() => {});
      await sleep(400);

      const pagination = await page.evaluate(() => {
        const isVisible = (el: Element) => {
          const he = el as HTMLElement;
          if (he.offsetParent !== null) return true;
          // offsetParent null for position:fixed but still visible — check bounding rect
          const r = he.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const isEnabled = (el: Element) => {
          const he = el as HTMLElement;
          if ((he as HTMLButtonElement).disabled) return false;
          if (he.getAttribute("aria-disabled") === "true") return false;
          if (he.getAttribute("disabled") !== null) return false;
          if (he.classList.contains("disabled")) return false;
          if (he.classList.contains("artdeco-button--disabled")) return false;
          if (he.classList.contains("pagination__next--disabled")) return false;
          return true;
        };
        // 1) Text / aria-label scan — catches i18n and icon-only buttons
        const allClickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        for (const el of allClickable) {
          const text = (el.textContent || "").trim().toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const title = (el.getAttribute("title") || "").toLowerCase();
          const isNext =
            aria.includes("next") ||
            title.includes("next") ||
            (text === "next") ||
            (text.includes("next") && text.length < 30);
          if (!isNext) continue;
          if (!isVisible(el) || !isEnabled(el)) continue;
          // Prefer pagination container
          const inPag = !!el.closest('.artdeco-pagination, .pagination, nav[aria-label*="pagination" i]');
          // Return with a selector we can re-find, or mark as text-based
          // Use a temporary marker to re-find via evaluate click
          (el as HTMLElement).setAttribute("data-hunt-next", "1");
          return { found: true, selector: '[data-hunt-next="1"]', via: "text" as const };
        }
        // 2) Known selectors fallback
        const selectors = [
          'button[aria-label*="Next" i]',
          'a[aria-label*="Next" i]',
          'button[aria-label*="next page" i]',
          'a[aria-label*="next page" i]',
          'button.artdeco-pagination__button--next',
          'li.artdeco-pagination__indicator--next button',
          'button.pagination__next-btn',
          'li.pagination__next button',
          '[data-test-pagination-next-btn]',
          '[data-testid="pagination-next"]',
          'button[data-testid*="next" i]',
          'a[rel="next"]',
          '.pagination a.next',
          '.pagination button.next',
          '.artdeco-pagination__button--next',
          'button:has-text("Next")',
          // JobStreet
          'button[aria-label="Next page"]',
          'a[aria-label="Next page"]',
        ];
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) continue;
            if (!isVisible(el) || !isEnabled(el)) continue;
            return { found: true, selector: sel, via: "selector" as const };
          } catch {
            continue;
          }
        }
        return { found: false, selector: null as string | null, via: null as null };
      });

      if (!pagination.found) {
        // No Next control — pagination exhausted. Clear marker if set.
        await page.evaluate(() => document.querySelectorAll("[data-hunt-next]").forEach((e) => e.removeAttribute("data-hunt-next"))).catch(() => {});
        hasMorePages = false;
        break;
      }

      // If we are on the last allowed page, report that more pages exist but don't navigate.
      if (pageIdx >= maxPages - 1) {
        // Clean marker
        await page.evaluate(() => document.querySelectorAll("[data-hunt-next]").forEach((e) => e.removeAttribute("data-hunt-next"))).catch(() => {});
        hasMorePages = true;
        break;
      }

      // Click Next and wait for the next page to load.
      // Record URL/candidate count before click to verify navigation
      const beforeUrl = page.url();
      const beforeCount = aggregated.length;
      const clicked = await page
        .evaluate((sel) => {
          const el = document.querySelector(sel as string) as HTMLElement | null;
          if (!el) return false;
          (el as HTMLElement).click();
          // Clean marker after click
          document.querySelectorAll("[data-hunt-next]").forEach((e) => e.removeAttribute("data-hunt-next"));
          return true;
        }, pagination.selector)
        .catch(() => false);

      if (!clicked) {
        hasMorePages = false;
        break;
      }

      // Wait for navigation / XHR to settle. Recruiter does client-side fetch,
      // so we wait for DOM to stabilise rather than a full navigation.
      await sleep(1200);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await sleep(1200);
      // Extra wait for candidate list to refresh — poll until URL or anchor count changes or timeout
      for (let w = 0; w < 8; w++) {
        const changed = await page
          .evaluate(
            ({ beforeUrl, beforeCount }) => {
              const urlChanged = location.href !== beforeUrl;
              const sel = 'a[href*="/in/"], a[href*="/talent/profile/"], a[href*="/recruiter/profile/"]';
              const now = document.querySelectorAll(sel).length;
              return urlChanged || now !== beforeCount;
            },
            { beforeUrl, beforeCount }
          )
          .catch(() => false);
        if (changed) break;
        await sleep(500);
      }
      await sleep(500);

      // Optional early-exit: if next page yields no new candidates after scroll,
      // the loop will still detect an empty newOnThisPage on next iteration,
      // but we continue to allow intentionally sparse pages.
    }

    // No total slice to maxPerPage — total is perPage * pages (multiplier).
    // Hard safety cap at backend max 500 still applies to avoid runaway.
    const capped = aggregated.length > 500 ? aggregated.slice(0, 500) : aggregated;
    return {
      count: capped.length,
      candidates: capped,
      debug: {
        matchedUrl,
        totalAnchors: lastTotalAnchors,
        inAnchors: lastInAnchors,
        pagesScraped,
        hasMorePages,
      },
    };
  } finally {
    void browser.close().catch(() => {});
  }
}

export type CandidateProfileResult = {
  url: string;
  name: string;
  raw: string;
};

/**
 * STEPS 3-5 — Open each candidate's profile → Scrape them → Close it.
 *
 * Strict lifecycle per candidate:
 *   1. OPEN  — create a dedicated background tab (never reuses / borrows the
 *              user's existing tabs) and keep the user's sourcing tab in the
 *              foreground.
 *   2. SCRAPE — navigate to the candidate URL, wait for hydration, scroll
 *               through lazy sections, extract sectioned text + name.
 *   3. CLOSE  — always close the background tab before returning, even on
 *               failure, so at most one extra tab is ever open.
 *
 * Why strict open/scrape/close instead of borrowing an existing
 * Talent/Recruiter tab?
 *   • Borrowing (navigating an existing SPA tab to the profile) can avoid the
 *     /talent/home bounce on some Recruiter builds, but it dirties the user's
 *     sourcing tab and violates the "close it" guarantee. The revamped flow
 *     prefers isolation and determinism; if a profile bounces to home the
 *     candidate is skipped with an explicit error rather than silently
 *     polluting local state.
 *   • Caller (HuntAutomation) batches ALL profiles first (steps 3-5 loop),
 *     then moves to STEP 6 (AI parse) and STEP 7 (match) — no interleaving.
 *
 * A page must load inside the authenticated browser — a plain server fetch
 * would hit LinkedIn's login wall.
 */
export async function extractCandidateProfile(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<CandidateProfileResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const samePath = (u: string) => {
    try {
      const a = new URL(u);
      return a.pathname.replace(/\/$/, "");
    } catch {
      return u;
    }
  };
  const want = samePath(targetUrl);

  // Refuse to open the Recruiter home / search root as a "profile" — that just
  // bounces the background tab to the Recruiter homepage. We need a real,
  // deep-linked candidate profile URL.
  if (!/^\/?(in|talent\/profile|recruiter\/profile)\b/i.test(want)) {
    void browser.close().catch(() => {});
    throw new Error(
      "That link is not a candidate profile (it points at the Recruiter home). " +
        "Re-run the scan and pick a search results tab so profiles can be opened."
    );
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());

  // Remember the user's currently visible tab so we can keep them there and
  // never "go into" the candidate's tab during scraping.
  let active: Page | null = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const vis = await p.evaluate(() => document.visibilityState).catch(() => null);
      if (vis === "visible") {
        active = p;
        break;
      }
    }
    if (active) break;
  }

  // STEP 3 — OPEN: create a dedicated background tab.
  const live: Page = await context.newPage();
  let closed = false;
  const closeLive = async () => {
    if (!closed && !live.isClosed()) {
      closed = true;
      await live.close().catch(() => {});
    }
  };

  try {
    // Keep the user's sourcing tab in the foreground.
    if (active) await active.bringToFront().catch(() => {});

    // Navigate to the candidate profile.
    await live.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2500);

    // Recruiter sometimes renders the profile in a spawned tab; if we detect
    // one that matches the wanted path, prefer it (and close the original).
    const spawned = context.pages().find((p) => p !== live && !p.isClosed() && samePath(p.url()) === want);
    let scrapePage: Page = live;
    let spawnedPage: Page | null = null;
    if (spawned) {
      spawnedPage = spawned;
      scrapePage = spawned;
    }

    try {
      // STEP 4 — SCRAPE: scroll through the profile to trigger lazy loading.
      await scrapePage
        .evaluate(async () => {
          for (let i = 0; i < 25; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            const main = document.querySelector(
              ".profile-detail, main, [role='main'], .scaffold-finite-scroll"
            );
            if (main) (main as HTMLElement).scrollTop = (main as HTMLElement).scrollHeight;
            await new Promise((r) => setTimeout(r, 350));
          }
        })
        .catch(() => {});

      const extracted = await scrapePage.evaluate(() => {
        const name = (
          document.querySelector("h1")?.textContent ||
          document.title ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        const sections = Array.from(document.querySelectorAll("section"));
        let txt = "";
        if (sections.length) {
          for (const s of sections) {
            const h = (s.querySelector("h1,h2,h3")?.textContent || "").trim();
            const body = (s.innerText || "").trim();
            txt += `\n\n### ${h}\n${body}`;
          }
        }
        if (!txt.trim()) txt = (document.body.innerText || "").trim();
        return {
          name,
          raw: txt.replace(/\n{3,}/g, "\n\n").slice(0, 25000).trim(),
        };
      });

      if (!extracted.raw || extracted.raw.length < 80) {
        throw new Error("Profile page did not contain enough extractable text (may have bounced to a login/home page).");
      }

      return { url: targetUrl, name: extracted.name, raw: extracted.raw };
    } finally {
      // STEP 5 — CLOSE spawned tab if we used it.
      if (spawnedPage && !spawnedPage.isClosed()) {
        await spawnedPage.close().catch(() => {});
      }
    }
  } finally {
    // STEP 5 — CLOSE the background tab we opened (guaranteed).
    await closeLive();
    // Detach the CDP connection (does not terminate the user's browser).
    void browser.close().catch(() => {});
  }
}

/**
 * Post-match navigation — return to the original "scrap candidate" page.
 * After STEPS 3-7 finish, the sourcing tab is left on the last pagination
 * page visited during STEP 2. This helper navigates it back to the original
 * search/project URL (`targetUrl`) so the recruiter lands back on the
 * candidate list, respecting the `maxPages` slider: if 3 pages were scraped,
 * we still return to page 1 after matching. No new tab is created.
 */
export async function returnToScrapePage(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<{ ok: boolean; url: string }> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }
  try {
    // Find the sourcing tab (prefer exact match, else any sourcing tab)
    let page: Page | null = null;
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        if (p.url() === targetUrl) {
          page = p;
          break;
        }
      }
      if (page) break;
    }
    if (!page) {
      // Fallback: any LinkedIn/JobStreet tab — navigate it to the original URL
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          if (isSourcingTab(p.url())) {
            page = p;
            break;
          }
        }
        if (page) break;
      }
    }
    if (!page) throw new Error("No sourcing tab to return to.");
    await page.bringToFront().catch(() => {});
    // Only navigate if we're not already on the exact target (avoid reload flicker)
    const current = page.url();
    const sameTarget = (() => {
      try {
        const a = new URL(current);
        const b = new URL(targetUrl);
        return a.host === b.host && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
      } catch {
        return current === targetUrl;
      }
    })();
    if (!sameTarget) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
    }
    await page.bringToFront().catch(() => {});
    return { ok: true, url: page.url() };
  } finally {
    void browser.close().catch(() => {});
  }
}
