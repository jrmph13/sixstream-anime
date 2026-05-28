const puppeteer = require("puppeteer");

let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-web-security",
        "--allow-running-insecure-content",
      ],
    });
  }
  return browser;
}

// Extract actual m3u8/mp4/stream URL + subtitles from an embed URL
async function scrapePlayerSources(embedUrl) {
  const br = await getBrowser();
  const page = await br.newPage();

  const sources = [];
  const subtitles = [];

  try {
    // Intercept network requests to capture m3u8 / mp4 / vtt urls
    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const url = req.url();
      const type = req.resourceType();

      // Block ads / trackers to speed things up
      const blocked = [
        "googlesyndication", "doubleclick", "claimedpasquil",
        "popads", "popcash", "adsterra", "statlytic", "bodegashunlike",
        "linkmansclate", "googletag", "googletagmanager",
      ];
      if (blocked.some((d) => url.includes(d))) {
        req.abort();
        return;
      }

      // Capture video sources as they are requested
      if (url.match(/\.(m3u8|mp4|webm|mkv|ts)(\?|$)/i)) {
        if (!sources.find((s) => s.url === url)) {
          sources.push({
            type: url.match(/\.m3u8/i) ? "hls" : url.match(/\.mp4/i) ? "mp4" : "video",
            url,
          });
        }
      }

      // Capture subtitle / transcript files
      if (url.match(/\.(vtt|srt|ass|ssa)(\?|$)/i)) {
        if (!subtitles.find((s) => s.url === url)) {
          subtitles.push({
            type: url.match(/\.vtt/i) ? "vtt" : url.match(/\.srt/i) ? "srt" : "subtitle",
            url,
          });
        }
      }

      req.continue();
    });

    // Also intercept responses to catch JSON APIs returning stream URLs
    page.on("response", async (res) => {
      const url = res.url();
      const ct = res.headers()["content-type"] || "";

      // Look for JSON responses that might contain stream URLs
      if (ct.includes("application/json") && url.includes("megaplay") || url.includes("vidwish")) {
        try {
          const json = await res.json();
          const text = JSON.stringify(json);
          // Extract any m3u8 / mp4 URLs from JSON response
          const matches = text.match(/https?:\/\/[^\s"']+\.(m3u8|mp4|webm)[^\s"']*/gi) || [];
          matches.forEach((u) => {
            if (!sources.find((s) => s.url === u)) {
              sources.push({ type: u.includes(".m3u8") ? "hls" : "mp4", url: u, fromApi: url });
            }
          });
          // Extract VTT subtitle URLs
          const vttMatches = text.match(/https?:\/\/[^\s"']+\.(vtt|srt)[^\s"']*/gi) || [];
          vttMatches.forEach((u) => {
            if (!subtitles.find((s) => s.url === u)) {
              subtitles.push({ type: "vtt", url: u, fromApi: url });
            }
          });
        } catch (_) {}
      }
    });

    await page.setExtraHTTPHeaders({
      Referer: "https://anisuge.se/",
      "Accept-Language": "en-US,en;q=0.9",
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    // Load the embed page
    await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for player JS to initialize
    await new Promise((r) => setTimeout(r, 3000));

    // Try clicking the play button (various selectors used by these players)
    for (const sel of [
      "#megaplay-player", ".jw-icon-playback", ".jw-display-icon-container",
      ".play-btn", ".content-center", "video", ".player", "#player",
      ".mg3-player", ".fix-area",
    ]) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      } catch (_) {}
    }

    // Wait for video stream request to fire
    await new Promise((r) => setTimeout(r, 6000));

    // Also check page source for inline m3u8/mp4 URLs
    const content = await page.content();
    const inlineM3u8 = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
    inlineM3u8.forEach((u) => {
      if (!sources.find((s) => s.url === u)) {
        sources.push({ type: "hls", url: u, from: "page-source" });
      }
    });
    const inlineVtt = content.match(/https?:\/\/[^\s"'<>]+\.vtt[^\s"'<>]*/gi) || [];
    inlineVtt.forEach((u) => {
      if (!subtitles.find((s) => s.url === u)) {
        subtitles.push({ type: "vtt", url: u, from: "page-source" });
      }
    });

  } finally {
    await page.close();
  }

  return { sources, subtitles };
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { scrapePlayerSources, closeBrowser };
