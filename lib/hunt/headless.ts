import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { DuplicateManager } from "./duplicate-manager";
import type { ScrapedCandidate, ScrapeCandidatesResult } from "./automation";

const DEFAULT_CDP = "http://127.0.0.1:9222";

const CHROME_LAUNCH_CMD =
  '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222';

function browserUnreachableError(endpoint: string): Error {
  return new Error(
    `Could not reach a browser at ${endpoint}.\n\n` +
      `Start Chrome with remote debugging enabled, then reload this tab. ` +
      `Run this in Terminal:\n\n` +
      `  ${CHROME_LAUNCH_CMD}\n`
  );
}

/**
 * Reads authenticated storage (cookies + localStorage) from the user's visible
 * Chrome via CDP. This is how a headless browser can act authenticated without
 * asking for LinkedIn credentials separately.
 *
 * We use storageState() rather than just cookies() so localStorage/sessionStorage
 * are carried over (some auth flows store there).
 */
async function getStorageStateFromCDP(
  endpoint: string = DEFAULT_CDP
): Promise<{ cookies: unknown[]; origins: unknown[] }> {
  let cdpBrowser: Browser | null = null;
  try {
    cdpBrowser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw browserUnreachableError(endpoint);
  }
  try {
    const contexts = cdpBrowser.contexts();
    if (contexts.length === 0) throw new Error("No browser context found in visible Chrome.");
    // Merge storageState from ALL contexts — auth may live in incognito/different profile
    const allCookies: unknown[] = [];
    const allOrigins: unknown[] = [];
    const seenOrigins = new Set<string>();
    for (const ctx of contexts) {
      try {
        const state = await ctx.storageState();
        for (const c of state.cookies as unknown[]) allCookies.push(c);
        for (const o of state.origins as unknown[]) {
          const key = JSON.stringify(o);
          if (!seenOrigins.has(key)) {
            seenOrigins.add(key);
            allOrigins.push(o);
          }
        }
      } catch {
        // ignore per-context failures
      }
    }
    // Fallback to raw cookies() if storageState was empty (some Chrome versions)
    if (allCookies.length === 0) {
      for (const ctx of contexts) {
        try {
          const cookies = await ctx.cookies();
          for (const c of cookies) allCookies.push(c);
        } catch {}
      }
    }
    if (allCookies.length === 0) {
      console.warn("[headless] No cookies captured from CDP — headless will likely hit login wall");
    } else {
      console.log(`[headless] Captured ${allCookies.length} cookies, ${allOrigins.length} origins from ${contexts.length} CDP contexts`);
    }
    return { cookies: allCookies, origins: allOrigins };
  } finally {
    void cdpBrowser.close().catch(() => {});
  }
}

async function launchHeadlessContext(
  storageState: { cookies: unknown[]; origins: unknown[] }
): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });
  const context = await browser.newContext({
    storageState: storageState as never,
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
    ignoreHTTPSErrors: true,
  });
  // Hide webdriver flag + other headless tells
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, "webdriver", { get: () => false });
    // @ts-expect-error chrome
    window.chrome = { runtime: {} };
    Object.defineProperty(window.navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(window.navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });
  return { browser, context };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reusable scroller/extractor logic — mirrors automation.ts scrapeSinglePage
// but runs inside the headless page which was navigated via goto().
async function scrapeCandidatesFromHeadlessPage(
  page: Page,
  maxPerPage: number
): Promise<{ candidates: ScrapedCandidate[]; totalAnchors: number; inAnchors: number }> {
  // Wait for anchor hydration — headless goto needs longer than visible tab (which is already hydrated)
  // Poll up to 8s for any candidate anchor before assuming empty page
  for (let w = 0; w < 10; w++) {
    const hasAnchor = await page.$('a[href*="/in/"], a[href*="/talent/profile/"], a[href*="/recruiter/profile/"], ol.profile-list').catch(() => null);
    if (hasAnchor) break;
    await sleep(800);
  }

  const isRecruiter =
    (await page.$("ol.profile-list")) !== null ||
    /linkedin\.com\/recruiter/i.test(page.url()) ||
    (await page.$('a[href*="/talent/profile/"], a[href*="/recruiter/profile/"]')) !== null;

  // Detect login wall early so we can surface a clear error instead of silently returning 0
  const url = page.url().toLowerCase();
  if (url.includes("/login") || url.includes("/authwall") || url.includes("/checkpoint")) {
    const title = await page.title().catch(() => "");
    throw new Error(
      `Headless browser hit login wall at ${page.url()} (title: ${title}). ` +
        `Cookies may not have synced. Ensure you launched Chrome with --remote-debugging-port=9222 and are logged into LinkedIn in that Chrome.`
    );
  }

  const data = await page.evaluate(async (recruiter: boolean) => {
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
    const norm = (u: string) => {
      try {
        const x = new URL(u);
        return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
      } catch {
        return u
          .replace(/^https?:\/\/(www\.)?/i, "")
          .split("?")[0]
          .split("#")[0]
          .replace(/\/+$/, "")
          .toLowerCase();
      }
    };
    const out: { name: string; url: string }[] = [];
    for (const a of all) {
      const match = a.href.match(
        /https?:\/\/(www\.)?linkedin\.com\/(?:in|talent\/profile|recruiter\/profile)\/[^\?#]+/i
      );
      if (!match) continue;
      const url = match[0];
      if (/\/(recruiter|talent)\/?($|\?|#)/i.test(url)) continue;
      const k = norm(url);
      if (seen.has(k)) continue;
      seen.add(k);
      let name = (a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      name = name.replace(/^View\s+profile\s+for\s+/i, "").trim();
      if (!name) name = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim();
      if (!name) {
        const parent = a.closest('[class*="name" i], [class*="title" i]') ?? a.parentElement;
        name = parent ? (parent.textContent || "").replace(/\s+/g, " ").trim() : "";
      }
      if (!name) name = url;
      out.push({ name, url });
    }
    if (recruiter && out.length === 0) {
      for (const li of Array.from(document.querySelectorAll("ol.profile-list > li"))) {
        const label =
          li.querySelector(".profile-list-item__selector .a11y-text")?.textContent?.trim() || "";
        const name = label.replace(/^Select\s+/i, "").trim();
        const link = li.querySelector(
          '.standard-profile-row a[href*="/talent/profile/"], .standard-profile-row a[href*="/recruiter/profile/"], .standard-profile-row a[href*="/in/"]'
        ) as HTMLAnchorElement | null;
        if (name && link?.href) out.push({ name, url: link.href });
      }
    }
    if (out.length === 0) {
      const genericSel = 'a[href*="/profile"], a[href*="/candidate"], a[href*="/resume"]';
      const generic = Array.from(document.querySelectorAll<HTMLAnchorElement>(genericSel));
      for (const a of generic) {
        const url = a.href.split("?")[0].split("#")[0];
        if (!url) continue;
        const k = norm(url);
        if (seen.has(k)) continue;
        seen.add(k);
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

  const perPageSlice = maxPerPage >= 500 ? data.candidates : data.candidates.slice(0, maxPerPage);
  return {
    candidates: perPageSlice as ScrapedCandidate[],
    totalAnchors: data.totalAnchors,
    inAnchors: data.inAnchors,
  };
}

/**
 * HEADLESS: scrape all candidate pages in ONE headless session.
 * Mirrors lib/hunt/automation.ts:scrapeCandidates but runs entirely inside
 * an invisible headless Chromium (launched on the user's machine by the Next.js
 * server). No visible windows/tabs appear — no bringToFront().
 *
 * Cookies/localStorage are synced from the visible Chrome via CDP so auth is
 * preserved. The headless page does goto(targetUrl) and then loops:
 *   scroll+extract -> click Next -> wait -> repeat up to maxPages.
 */
export async function scrapeCandidatesHeadless(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP,
  options: { maxPages?: number; maxCandidates?: number } = {}
): Promise<ScrapeCandidatesResult> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 10, 50));
  const maxPerPage = Math.max(1, Math.min(options.maxCandidates ?? 25, 500));

  const storageState = await getStorageStateFromCDP(endpoint);
  const { browser, context } = await launchHeadlessContext(storageState);
  let page: Page | null = null;

  try {
    page = await context.newPage();
    console.log(`[headless] goto ${targetUrl}`);
    const gotoRes = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
      console.error("[headless] goto failed", e);
      throw e;
    });
    console.log(`[headless] goto status ${gotoRes?.status()} url ${page.url()}`);
    // Wait for SPA hydration — LinkedIn Recruiter loads via XHR after domcontentloaded
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(3000);
    // Extra poll for body content before scraping
    for (let w = 0; w < 6; w++) {
      const bodyLen = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
      if (bodyLen > 500) break;
      await sleep(800);
    }
    // Abort early if we hit login wall before scraping
    const preUrl = page.url().toLowerCase();
    if (preUrl.includes("/login") || preUrl.includes("/authwall") || preUrl.includes("/checkpoint")) {
      const html = await page.content().catch(() => "");
      console.error("[headless] login wall HTML snippet", html.slice(0, 2000));
      throw new Error(`Headless hit login wall at ${page.url()}. Cookie sync may have failed.`);
    }

    const dupManager = new DuplicateManager();
    const aggregated: ScrapedCandidate[] = [];
    let lastTotalAnchors = 0;
    let lastInAnchors = 0;
    let pagesScraped = 0;
    let hasMorePages = false;
    let totalDuplicatesFiltered = 0;

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      console.log(`[headless] scraping page ${pageIdx + 1}/${maxPages} at ${page.url()}`);
      const data = await scrapeCandidatesFromHeadlessPage(page, maxPerPage);
      console.log(`[headless] page ${pageIdx + 1} found ${data.candidates.length} candidates (anchors ${data.totalAnchors}/${data.inAnchors})`);
      lastTotalAnchors = data.totalAnchors;
      lastInAnchors = data.inAnchors;
      pagesScraped++;

      // Debug when 0 candidates but page looks non-empty
      if (data.candidates.length === 0) {
        const debugInfo = await page.evaluate(() => ({
          title: document.title,
          bodySnippet: document.body.innerText.slice(0, 800),
          anchorCount: document.querySelectorAll("a").length,
          url: location.href,
        })).catch(() => null);
        console.warn(`[headless] 0 candidates on page ${pageIdx + 1}`, debugInfo);
      }

      const { unique, duplicateCount } = dupManager.filter(data.candidates as { url: string }[]);
      totalDuplicatesFiltered += duplicateCount;
      aggregated.push(...(unique as ScrapedCandidate[]));
      console.log(`[headless] aggregated ${aggregated.length} unique so far, duplicates filtered ${totalDuplicatesFiltered}`);

      const isUnlimitedTotal = maxPerPage >= 500 || maxPages >= 50;
      const totalLimit = isUnlimitedTotal ? Infinity : maxPerPage * maxPages;
      if (aggregated.length >= totalLimit) {
        hasMorePages = true;
        break;
      }
      if (pageIdx >= maxPages - 1) {
        // Check if more pages exist without navigating
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await sleep(400);
        const hasNext = await hasNextPage(page);
        hasMorePages = hasNext;
        break;
      }

      // Try to go to next page
      const moved = await clickNextHeadless(page);
      console.log(`[headless] pagination moved=${moved} from page ${pageIdx + 1}`);
      if (!moved) {
        hasMorePages = false;
        break;
      }
      // Wait for next page hydration before next loop
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await sleep(1500);
    }

    const capped = aggregated.length > 500 ? aggregated.slice(0, 500) : aggregated;
    return {
      count: capped.length,
      candidates: capped,
      debug: {
        matchedUrl: page.url(),
        totalAnchors: lastTotalAnchors,
        inAnchors: lastInAnchors,
        pagesScraped,
        hasMorePages,
        duplicatesFiltered: totalDuplicatesFiltered,
        uniqueCount: aggregated.length,
      },
    };
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * HEADLESS: single-page scrape only (no pagination). Used when caller wants
 * per-page loop control outside. Launches a fresh headless page, navigates,
 * scrapes, closes. For pagination loops, prefer scrapeCandidatesHeadless()
 * which keeps a single page across pagination clicks.
 */
export async function scrapeSinglePageHeadless(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP,
  maxPerPage: number = 25
): Promise<{ count: number; candidates: ScrapedCandidate[]; debug: { matchedUrl: string | null; totalAnchors: number; inAnchors: number } }> {
  const storageState = await getStorageStateFromCDP(endpoint);
  const { browser, context } = await launchHeadlessContext(storageState);
  try {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2500);
    const data = await scrapeCandidatesFromHeadlessPage(page, maxPerPage);
    return {
      count: data.candidates.length,
      candidates: data.candidates,
      debug: {
        matchedUrl: page.url(),
        totalAnchors: data.totalAnchors,
        inAnchors: data.inAnchors,
      },
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function hasNextPage(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        if (he.offsetParent !== null) return true;
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
      const allClickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const el of allClickable) {
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const title = (el.getAttribute("title") || "").toLowerCase();
        const isNext =
          aria.includes("next") || title.includes("next") || text === "next" || (text.includes("next") && text.length < 30);
        if (!isNext) continue;
        if (!isVisible(el) || !isEnabled(el)) continue;
        return true;
      }
      const selectors = [
        'button[aria-label*="Next" i]',
        'a[aria-label*="Next" i]',
        'button.artdeco-pagination__button--next',
        'li.artdeco-pagination__indicator--next button',
        'button.pagination__next-btn',
        'a[rel="next"]',
      ];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) continue;
          if (!isVisible(el) || !isEnabled(el)) continue;
          return true;
        } catch {
          continue;
        }
      }
      return false;
    })
    .catch(() => false);
}

async function clickNextHeadless(page: Page): Promise<boolean> {
  const before = page.url();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(600);
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
    const allClickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const el of allClickable) {
      const text = (el.textContent || "").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const title = (el.getAttribute("title") || "").toLowerCase();
      const isNext = aria.includes("next") || title.includes("next") || text === "next" || (text.includes("next") && text.length < 30);
      if (!isNext) continue;
      if (!isVisible(el) || !isEnabled(el)) continue;
      (el as HTMLElement).setAttribute("data-hunt-next", "1");
      return { found: true, selector: '[data-hunt-next="1"]' as string };
    }
    const selectors = [
      'button[aria-label*="Next" i]',
      'a[aria-label*="Next" i]',
      'button.artdeco-pagination__button--next',
      'li.artdeco-pagination__indicator--next button',
      'button.pagination__next-btn',
      '[data-test-pagination-next-btn]',
      'a[rel="next"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) continue;
        if (!isVisible(el) || !isEnabled(el)) continue;
        return { found: true, selector: sel };
      } catch {
        continue;
      }
    }
    return { found: false, selector: null as string | null };
  });

  if (!pagination.found || !pagination.selector) return false;

  const clicked = await page
    .evaluate((sel) => {
      const el = document.querySelector(sel as string) as HTMLElement | null;
      if (!el) return false;
      (el as HTMLElement).click();
      document.querySelectorAll("[data-hunt-next]").forEach((e) => e.removeAttribute("data-hunt-next"));
      return true;
    }, pagination.selector)
    .catch(() => false);

  if (!clicked) return false;

  await sleep(1200);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(1200);
  for (let w = 0; w < 8; w++) {
    const changed = await page.evaluate(({ beforeUrl }) => location.href !== beforeUrl, { beforeUrl: before }).catch(() => false);
    if (changed) break;
    await sleep(500);
  }
  await sleep(500);
  await page.evaluate(() => document.querySelectorAll("[data-hunt-next]").forEach((e) => e.removeAttribute("data-hunt-next"))).catch(() => {});
  return true;
}

// ── Headless candidate profile extraction ──

export type HeadlessCandidateProfileResult = {
  url: string;
  name: string;
  raw: string;
};

/**
 * HEADLESS: Open each candidate's profile → Scrape → Close, invisibly.
 * Unlike lib/hunt/automation.ts:extractCandidateProfile which creates a
 * visible background tab in the user's Chrome (and briefly flickers), this
 * launches a headless Chromium, syncs auth via storageState, then does
 * page.goto -> scroll -> extract in complete isolation. No windows/tabs
 * appear in the user's browser.
 */
export async function extractCandidateProfileHeadless(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<HeadlessCandidateProfileResult> {
  const samePath = (u: string) => {
    try {
      const a = new URL(u);
      return a.pathname.replace(/\/$/, "");
    } catch {
      return u;
    }
  };
  const want = samePath(targetUrl);
  if (!/^\/?(in|talent\/profile|recruiter\/profile)\b/i.test(want)) {
    throw new Error(
      "That link is not a candidate profile (it points at the Recruiter home). " +
        "Re-run the scan and pick a search results tab so profiles can be opened."
    );
  }

  const storageState = await getStorageStateFromCDP(endpoint);
  const { browser, context } = await launchHeadlessContext(storageState);

  try {
    const page = await context.newPage();
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(2500);

      // Scroll to trigger lazy sections
      await page
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

      const extracted = await page.evaluate(() => {
        const name = (
          document.querySelector("h1")?.textContent || document.title || ""
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
        throw new Error(
          "Profile page did not contain enough extractable text (may have bounced to a login/home page)."
        );
      }
      return { url: targetUrl, name: extracted.name, raw: extracted.raw };
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export { DEFAULT_CDP };
