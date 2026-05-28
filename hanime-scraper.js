/**
 * hanime-scraper.js
 *
 * Browse/search uses the public search_hvs JSON endpoint — no auth needed.
 * Video detail (getVideoInfo) uses puppeteer to pull stream URLs from the page's
 * Vue store, since those require the hanime desktop app's private DNS to resolve.
 */

const axios    = require("axios");
const axiosRetry = require("axios-retry").default;

// ── Axios client for hanime API ───────────────────────────────────────────────
const client = axios.create({
  headers: {
    "User-Agent":           "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":               "application/json, text/plain, */*",
    "Accept-Encoding":      "gzip, deflate, br",
    "Referer":              "https://hanime.tv/",
    "Origin":               "https://hanime.tv",
    "x-csrf-token":         "",
    "x-session-token":      "",
    "x-license":            "",
    "x-user-license":       "",
    "x-signature-version":  "web2",
    "x-signature":          "",
    "x-time":               "0",
  },
  decompress: true,
  timeout: 30000,
});
axiosRetry(client, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const HVS_URL = "https://cached.freeanimehentai.net/api/v10/search_hvs";

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseCard(v) {
  if (!v) return null;
  return {
    id:        v.id         || null,
    slug:      v.slug       || null,
    title:     v.name       || v.title || null,
    poster:    v.cover_url  || v.poster_url || null,
    views:     v.views      || 0,
    likes:     v.likes      || 0,
    duration:  v.duration_in_ms ? Math.round(v.duration_in_ms / 1000) : null,
    tags:      (v.tags      || []).map(t => typeof t === "string" ? t : (t.text || "")),
    brands:    (v.brands    || []).map(b => typeof b === "string" ? b : (b.title || "")),
    brand:     v.brand      || null,
    createdAt: v.created_at || null,
  };
}

// ── In-memory search index (loaded once from hanime's public endpoint) ────────
let _hvs     = null;
let _hvsTime = 0;
const HVS_TTL = 30 * 60 * 1000; // 30 min

async function getHVS() {
  if (_hvs && Date.now() - _hvsTime < HVS_TTL) return _hvs;
  console.log("[hanime] fetching video index...");
  const res = await client.get(HVS_URL);
  _hvs = Array.isArray(res.data) ? res.data : [];
  _hvsTime = Date.now();
  console.log("[hanime] index loaded:", _hvs.length, "videos");
  return _hvs;
}

// ── Public browse/search API (no puppeteer needed) ────────────────────────────

async function getTrending(page = 0, perPage = 24) {
  const hvs = await getHVS();
  return [...hvs]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(page * perPage, (page + 1) * perPage)
    .map(parseCard).filter(Boolean);
}

async function getNew(page = 0, perPage = 24) {
  const hvs = await getHVS();
  return [...hvs]
    .sort((a, b) => (b.created_at || "") > (a.created_at || "") ? -1 : 1)
    .slice(page * perPage, (page + 1) * perPage)
    .map(parseCard).filter(Boolean);
}

async function searchHentai({ query = "", page = 0, perPage = 24, tags = [], brands = [] } = {}) {
  const hvs = await getHVS();
  const q   = query.toLowerCase().trim();

  const results = hvs.filter(v => {
    const textMatch = !q || (
      (v.name          || "").toLowerCase().includes(q) ||
      (v.search_titles || "").toLowerCase().includes(q) ||
      (v.description   || "").toLowerCase().includes(q)
    );
    const tagMatch = !tags.length || tags.every(t =>
      (v.tags || []).some(vt => (typeof vt === "string" ? vt : vt.text || "").toLowerCase() === t.toLowerCase())
    );
    const brandMatch = !brands.length || brands.every(b =>
      (v.brand || "").toLowerCase() === b.toLowerCase()
    );
    return textMatch && tagMatch && brandMatch;
  });

  return results
    .slice(page * perPage, (page + 1) * perPage)
    .map(parseCard).filter(Boolean);
}

async function browse({ page = 0, perPage = 24, tags = [], brands = [] } = {}) {
  return searchHentai({ query: "", page, perPage, tags, brands });
}

async function getTags() {
  const hvs = await getHVS();
  const counts = new Map();
  hvs.forEach(v => {
    (v.tags || []).forEach(t => {
      const name = typeof t === "string" ? t : (t.text || "");
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}

async function getBrands() {
  const hvs = await getHVS();
  const brands = new Map();
  hvs.forEach(v => {
    const name = v.brand;
    const id   = v.brand_id;
    if (name && !brands.has(name)) brands.set(name, { id, title: name });
  });
  return Array.from(brands.values()).sort((a, b) => a.title.localeCompare(b.title));
}

async function getVideoMeta(slug) {
  const hvs  = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};
  const card = parseCard(meta) || { slug, title: slug };
  const tagTexts = (meta.tags || [])
    .map(t => typeof t === "string" ? t : (t.text || ""))
    .filter(Boolean);

  const related = hvs
    .filter(v => v.slug !== slug && tagTexts.some(t =>
      (v.tags || []).some(vt => (typeof vt === "string" ? vt : vt.text) === t)
    ))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 12)
    .map(parseCard).filter(Boolean);

  return {
    ...card,
    description: meta.description || null,
    tags:        tagTexts.map(text => ({ text })),
    brands:      meta.brand ? [{ id: meta.brand_id || null, title: meta.brand }] : [],
    franchise:   null,
    related,
    sources:     [],
  };
}

// ── WASM-signed API client ────────────────────────────────────────────────────
// Gets a fresh signature from the running puppeteer page and uses it to call
// authenticated hanime endpoints. The signature expires every ~5 minutes so
// we re-fetch it from the page on each video request (it's a cheap evaluate).
async function getSignedHeaders() {
  try {
    const puppeteer = require("puppeteer");
    if (!_browser) {
      _browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      _browser.on("disconnected", () => { _browser = null; });
    }
    // Reuse or open a signing page
    let spage = _sigPage;
    if (!spage || spage.isClosed()) {
      spage = await _browser.newPage();
      await spage.setRequestInterception(true);
      spage.on("request", req => {
        if (["image","font","stylesheet","media"].includes(req.resourceType())) req.abort();
        else req.continue();
      });
      await spage.goto("https://hanime.tv/home", { waitUntil: "domcontentloaded", timeout: 25000 });
      await spage.waitForFunction("window.stime > 0", { timeout: 15000 }).catch(() => {});
      _sigPage = spage;
    }
    const auth = await spage.evaluate(() => ({ sig: window.ssignature || "", time: window.stime || 0 }));
    return {
      "User-Agent":           "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":               "application/json, */*",
      "Accept-Encoding":      "gzip, deflate, br",
      "Referer":              "https://hanime.tv/",
      "Origin":               "https://hanime.tv",
      "x-csrf-token":         "",
      "x-session-token":      "",
      "x-license":            "",
      "x-user-license":       "",
      "x-signature-version":  "web2",
      "x-signature":          auth.sig,
      "x-time":               String(auth.time),
    };
  } catch (_) {
    // Fallback: empty signatures (works for search_hvs but not video detail)
    return {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://hanime.tv/",
      "x-csrf-token": "", "x-session-token": "", "x-signature": "",
      "x-time": "0", "x-signature-version": "web2",
    };
  }
}
let _sigPage = null;

// ── Video detail ──────────────────────────────────────────────────────────────
// Uses the WASM-signed API to get the real videos_manifest including stream URLs.
// The stream URL (streamable.cloud) is returned as-is to the CLIENT — the browser
// resolves it directly, which works for users with the hanime desktop app.
async function getVideoInfo(slug) {
  const hvs  = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};
  const card = parseCard(meta) || { slug, title: slug };
  const tagTexts = (meta.tags || [])
    .map(t => typeof t === "string" ? t : (t.text || ""))
    .filter(Boolean);

  // Related: same-tag videos, sorted by views
  const related = hvs
    .filter(v => v.slug !== slug && tagTexts.some(t =>
      (v.tags || []).some(vt => (typeof vt === "string" ? vt : vt.text) === t)
    ))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 16)
    .map(parseCard).filter(Boolean);

  // Fetch real stream data via authenticated API
  const sources = [];
  try {
    const headers = await getSignedHeaders();
    const apiRes = await client.get(
      `https://cached.freeanimehentai.net/api/v8/video?id=${encodeURIComponent(slug)}`,
      { headers, timeout: 15000 }
    );
    const manifest = apiRes.data?.videos_manifest;
    for (const server of (manifest?.servers || [])) {
      for (const stream of (server.streams || [])) {
        if (!stream.url) continue;
        sources.push({
          server:    server.name  || server.slug || "hanime",
          url:       stream.url,   // e.g. https://streamable.cloud/hls/stream.m3u8
          quality:   stream.height ? `${stream.height}p` : "auto",
          kind:      stream.kind  || (stream.url.includes(".m3u8") ? "hls" : "mp4"),
          extension: stream.extension || null,
          sizeMB:    stream.filesize_mbs || null,
        });
      }
    }
  } catch (e) {
    console.error("[hanime] video API error:", e.message);
  }

  // Embed fallback (always available, video may not play without desktop app)
  sources.push({
    server:    "embed",
    url:       "https://hanime.tv/videos/hentai/" + slug,
    quality:   "embed",
    kind:      "embed",
    extension: null,
    sizeMB:    null,
  });

  return {
    ...card,
    description: meta.description || null,
    tags:        tagTexts.map(text => ({ text })),
    brands:      meta.brand ? [{ id: meta.brand_id || null, title: meta.brand }] : [],
    franchise:   null,
    sources,
    related,
  };
}

// Best-effort: navigate to video page and extract dl_url from Vue store
let _browser = null;
async function getPuppeteerDlUrl(puppeteer, slug) {
  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    _browser.on("disconnected", () => { _browser = null; });
  }

  const page = await _browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", req => {
    const rt = req.resourceType();
    if (["image","font","stylesheet","media"].includes(rt)) req.abort();
    else req.continue();
  });

  try {
    await page.goto("https://hanime.tv/videos/hentai/" + slug, {
      waitUntil: "domcontentloaded",
      timeout:   20000,
    });
    await new Promise(r => setTimeout(r, 4000));

    return await page.evaluate(function() {
      function findS(vm, d) {
        if (d > 5 || !vm) return null;
        if (vm.$S) return vm.$S;
        for (var i = 0; i < (vm.$children || []).length; i++) {
          var r = findS(vm.$children[i], d + 1);
          if (r) return r;
        }
        return null;
      }
      var vue = document.querySelector("#app").__vue__;
      var S = vue && findS(vue, 0);
      return S && S.data && S.data.video && S.data.video.dl_url || null;
    });
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}

module.exports = {
  getTrending,
  getNew,
  browse,
  searchHentai,
  getTags,
  getBrands,
  getVideoMeta,
  getVideoInfo,
  closeBrowser,
};
