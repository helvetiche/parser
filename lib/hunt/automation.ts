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
    throw new Error(
      `Could not reach a browser at ${endpoint}. Start Chrome with: ` +
        `--remote-debugging-port=9222 (then reload this tab).`
    );
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
 * Brings the already-open tab matching `targetUrl` to the foreground in the
 * user's browser (the first step of the hunt automation: act on a chosen tab).
 */
export async function focusBrowserTab(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<FocusTabResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw new Error(
      `Could not reach a browser at ${endpoint}. Start Chrome with: ` +
        `--remote-debugging-port=9222 (then reload this tab).`
    );
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
  };
};

/**
 * Step 2 of the automation: scrape candidate names + profile links from the
 * chosen LinkedIn tab. Pulls every `linkedin.com/in/...` anchor on the page
 * and resolves the candidate name from aria-label / text / parent.
 */
export async function scrapeCandidates(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<ScrapeCandidatesResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw new Error(
      `Could not reach a browser at ${endpoint}. Start Chrome with: ` +
        `--remote-debugging-port=9222 (then reload this tab).`
    );
  }

  try {
    // Prefer an exact URL match; fall back to any LinkedIn tab so a slightly
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
      for (const context of contexts) {
        for (const p of context.pages()) {
          if (p.url().includes("linkedin.com")) {
            page = p;
            break;
          }
        }
        if (page) break;
      }
    }
    if (!page) throw new Error("Selected tab is no longer open in the browser.");
    matchedUrl = page.url();

    // LinkedIn Recruiter project list: candidates live in
    // `ol.profile-list > li` and lazy-load as you scroll. Prefer that
    // structure when present; otherwise fall back to public `/in/` links.
    const isRecruiter = (await page.$("ol.profile-list")) !== null;

    const data = isRecruiter
      ? await page.evaluate(async () => {
          const sel = "ol.profile-list > li";
          const scroller =
            (document.querySelector("ol.profile-list")?.parentElement as HTMLElement) ||
            document.scrollingElement;
          let last = 0;
          let stable = 0;
          // Scroll to lazy-load every candidate (mirrors AutoRecruiter).
          for (let i = 0; i < 40; i++) {
            scroller.scrollTop = scroller.scrollHeight;
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise((r) => setTimeout(r, 500));
            const n = document.querySelectorAll(sel).length;
            if (n === last) {
              if (++stable >= 3) break;
            } else {
              stable = 0;
            }
            last = n;
          }

          const candidates = [...document.querySelectorAll(sel)]
            .map((li) => {
              const label =
                li
                  .querySelector(".profile-list-item__selector .a11y-text")
                  ?.textContent?.trim() || "";
              const name = label.replace(/^Select\s+/i, "").trim();
              const a = li.querySelector(
                '.standard-profile-row a[href*="/talent/"], .standard-profile-row a[href*="linkedin.com"]'
              ) as HTMLAnchorElement | null;
              return { name, url: a ? a.href : "" };
            })
            .filter((c) => c.name.length > 0 && c.url.length > 0);

          return {
            candidates,
            totalAnchors: document.querySelectorAll("a").length,
            inAnchors: document.querySelectorAll(sel).length,
          };
        })
      : await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
          const inAnchors = all.filter((a) => /linkedin\.com\/in\//i.test(a.href));
          const seen = new Set<string>();
          const out: { name: string; url: string }[] = [];

          for (const a of inAnchors) {
            const match = a.href.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\/?#]+/i);
            if (!match) continue;
            const url = match[0];
            if (seen.has(url)) continue;
            seen.add(url);

            // Name hunt: aria-label → visible text → nearest labelled parent.
            let name = (a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
            if (!name) name = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim();
            if (!name) {
              const parent =
                a.closest('[class*="name" i], [class*="title" i]') ?? a.parentElement;
              name = parent ? (parent.textContent || "").replace(/\s+/g, " ").trim() : "";
            }
            if (!name) name = url;
            out.push({ name, url });
          }
          return { candidates: out, totalAnchors: all.length, inAnchors: inAnchors.length };
        });

    return {
      count: data.candidates.length,
      candidates: data.candidates,
      debug: {
        matchedUrl,
        totalAnchors: data.totalAnchors,
        inAnchors: data.inAnchors,
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
 * Step 3 of the automation: open a candidate's profile and extract the
 * structured text (name + sectioned profile content).
 *
 * If the profile is ALREADY open in one of the user's tabs we read that tab
 * directly (no new tab). Otherwise we open a throwaway BACKGROUND tab (never
 * brought to front) and close it afterwards. A page must load inside the
 * authenticated browser — a plain server fetch would hit LinkedIn's login wall.
 */
export async function extractCandidateProfile(
  targetUrl: string,
  endpoint: string = DEFAULT_CDP
): Promise<CandidateProfileResult> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    throw new Error(
      `Could not reach a browser at ${endpoint}. Start Chrome with: ` +
        `--remote-debugging-port=9222 (then reload this tab).`
    );
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

  // Reuse an already-open tab if present; otherwise we open one just for scraping.
  let live: Page | null = null;
  for (const context of browser.contexts()) {
    for (const p of context.pages()) {
      if (!p.isClosed() && samePath(p.url()) === want) {
        live = p;
        break;
      }
    }
    if (live) break;
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

  // `ownPage` = we created this tab, so we are responsible for closing it after.
  let ownPage = false;
  if (!live) {
    // Open the candidate's profile in a BACKGROUND tab, then immediately return
    // focus to the user's original tab. It's scraped in the background and
    // closed afterwards, so no tab is left open and the user never sees it.
    live = await context.newPage();
    ownPage = true;
    if (active) await active.bringToFront().catch(() => {});
    await live.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2500);
    // Recruiter sometimes renders the profile in a spawned tab; prefer it.
    const spawned = context.pages().find((p) => samePath(p.url()) === want);
    if (spawned) live = spawned;
  }

  try {
    // Scroll through the profile to trigger lazy loading of all sections.
    // Works fine on a background tab; we never have to focus it.
    await live
      .evaluate(async () => {
        for (let i = 0; i < 25; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          const main = document.querySelector(
            ".profile-detail, main, [role='main'], .scaffold-finite-scroll"
          );
          if (main) (main as HTMLElement).scrollTop = main.scrollHeight;
          await new Promise((r) => setTimeout(r, 350));
        }
      })
      .catch(() => {});

    const extracted = await live.evaluate(() => {
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

    return { url: targetUrl, name: extracted.name, raw: extracted.raw };
  } finally {
    // Close the throwaway tab we opened for scraping; never the user's own tab.
    if (ownPage) await live.close().catch(() => {});
    // Detach the CDP connection (does not terminate the user's browser).
    void browser.close().catch(() => {});
  }
}
