/**
 * hanime-scraper.js
 *
 * hanime.tv signs every API request with a WebAssembly-generated HMAC that includes
 * a rolling timestamp. Replicating the WASM binary in Node.js is impractical, so we
 * keep a single headless Chromium page loaded at hanime.tv and call the site's own
 * internal Vue/Axios client via page.evaluate() — the browser handles signing for free.
 */

const puppeteer = require("puppeteer");

// ── Persistent browser state ──────────────────────────────────────────────────
let _browser = null;
let _page    = null;
let _ready   = false;

async function getPage() {
  if (_browser && _page && !_page.isClosed() && _ready) return _page;

  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    _browser.on("disconnected", () => { _browser = null; _page = null; _ready = false; });
  }

  _page  = await _browser.newPage();
  _ready = false;

  // Block images/fonts to speed up load
  await _page.setRequestInterception(true);
  _page.on("request", req => {
    const t = req.resourceType();
    if (["image","font","media","stylesheet"].includes(t)) req.abort();
    else req.continue();
  });

  console.log("[hanime] loading browser session…");
  await _page.goto("https://hanime.tv/home", {
    waitUntil: "domcontentloaded",
    timeout:   30000,
  });

  // Wait for the WASM to set window.stime (max 15s)
  await _page.waitForFunction("window.stime > 0", { timeout: 15000 }).catch(() => {});
  _ready = true;
  console.log("[hanime] browser session ready, stime =", await _page.evaluate(() => window.stime));
  return _page;
}

// Shutdown helper (called from server on exit)
async function closeBrowser() {
  if (_browser) { await _browser.close(); _browser = null; _page = null; _ready = false; }
}

// ── Core API caller ───────────────────────────────────────────────────────────
// Calls the site's own Axios instance ($get) which auto-includes the WASM signature.
async function hanimeGet(path) {
  const page = await getPage();
  const result = await page.evaluate(async (p) => {
    try {
      const ctx = window.ctx || (window.__vue_app__?.config?.globalProperties);
      let data;
      if (ctx && ctx.$get) {
        const r = await ctx.$get(p);
        data = r.data;
      } else {
        // Fallback: native fetch (works for endpoints that don't need WASM sig on this session)
        const r = await fetch(p, {
          headers: {
            "Accept":          "application/json",
            "Content-Type":    "application/json",
            "x-signature":     window.ssignature || "",
            "x-time":          String(window.stime || 0),
            "x-session-token": "",
            "x-csrf-token":    "",
            "x-license":       "",
            "x-user-license":  "",
            "x-signature-version": "web2",
          },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json();
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, path);

  if (!result.ok) throw new Error(result.error || "hanime API error");
  return result.data;
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function fmtViews(n) {
  if (!n) return 0;
  if (n >= 1e6) return parseFloat((n / 1e6).toFixed(1)) + "M";
  if (n >= 1e3) return parseFloat((n / 1e3).toFixed(0)) + "K";
  return n;
}

function parseCard(v) {
  if (!v) return null;
  return {
    id:        v.id       || null,
    slug:      v.slug     || null,
    title:     v.name     || v.title || null,
    poster:    v.cover_url || v.poster_url || null,
    views:     v.views    || 0,
    likes:     v.likes    || 0,
    duration:  v.duration_in_ms ? Math.round(v.duration_in_ms / 1000) : null,
    tags:      (v.hentai_tags  || v.tags  || []).map(t => typeof t === "string" ? t : t.text),
    brands:    (v.hentai_brands || v.brands || []).map(b => typeof b === "string" ? b : b.title),
    createdAt: v.created_at || null,
  };
}

function parseSources(manifest) {
  const sources = [];
  for (const server of (manifest?.servers || [])) {
    for (const stream of (server.streams || [])) {
      if (!stream.url) continue;
      sources.push({
        server:    server.name || server.slug || "default",
        url:       stream.url,
        quality:   stream.height ? `${stream.height}p` : "unknown",
        kind:      stream.kind || (stream.url.includes(".m3u8") ? "hls" : "mp4"),
        extension: stream.extension || null,
        sizeMB:    stream.filesize_mbs || null,
      });
    }
  }
  // HLS first, then descending quality
  return sources.sort((a, b) => {
    if (a.kind === "hls" && b.kind !== "hls") return -1;
    if (b.kind === "hls" && a.kind !== "hls") return 1;
    return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
  });
}

function pixeldrainId(url) {
  if (!url) return null;
  const match = String(url).match(/pixeldrain\.com\/(?:d|u)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

// ── In-memory search index (loaded once from SEARCH_HVS_URL) ─────────────────
// hanime ships a full search index to the client (~several MB JSON).
// We use that for browse/search so we don't need the authenticated REST API.
let _hvs     = null;
let _hvsTime = 0;
const HVS_TTL = 30 * 60 * 1000; // 30 min

async function getHVS() {
  if (_hvs && Date.now() - _hvsTime < HVS_TTL) return _hvs;
  const page = await getPage();
  console.log("[hanime] loading video index…");
  _hvs = await page.evaluate(async () => {
    // The app pre-loads the entire search index into window.search_hvs
    if (window.search_hvs && window.search_hvs.length > 0) return window.search_hvs;
    // If not loaded yet, fetch it
    const cfg = window.ctx?.$config;
    const url = (cfg?.SEARCH_HVS_URL) || "https://search.htv-services.com/search";
    const r = await fetch(url);
    if (!r.ok) throw new Error("SEARCH_HVS_URL fetch failed: " + r.status);
    return r.json();
  });
  _hvsTime = Date.now();
  console.log("[hanime] index loaded:", _hvs.length, "videos");
  return _hvs;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getTrending(page = 0, perPage = 24) {
  const hvs = await getHVS();
  // Sort by views desc as proxy for "trending"
  return [...hvs]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(page * perPage, (page + 1) * perPage)
    .map(parseCard)
    .filter(Boolean);
}

async function getNew(page = 0, perPage = 24) {
  const hvs = await getHVS();
  // Sort by created_at desc
  return [...hvs]
    .sort((a, b) => (b.created_at || "") > (a.created_at || "") ? 1 : -1)
    .slice(page * perPage, (page + 1) * perPage)
    .map(parseCard)
    .filter(Boolean);
}

async function searchHentai({ query = "", page = 0, perPage = 24, tags = [], brands = [] } = {}) {
  const hvs = await getHVS();
  const q   = query.toLowerCase().trim();

  let results = hvs.filter(v => {
    const textMatch = !q || (
      (v.name || "").toLowerCase().includes(q) ||
      (v.search_titles || "").toLowerCase().includes(q) ||
      (v.description || "").toLowerCase().includes(q)
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
    .map(parseCard)
    .filter(Boolean);
}

async function browse({ page = 0, perPage = 24, tags = [], brands = [], ordering = "created_at_desc" } = {}) {
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
  const hvs = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};
  const card = parseCard(meta) || { slug, title: slug };
  const tags = (meta.tags || [])
    .map(t => typeof t === "string" ? t : (t.text || ""))
    .filter(Boolean);

  const related = hvs
    .filter(v => v.slug !== slug && tags.some(t =>
      (v.tags || []).some(vt => (typeof vt === "string" ? vt : vt.text) === t)
    ))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 12)
    .map(parseCard)
    .filter(Boolean);

  return {
    ...card,
    description: meta.description || null,
    tags: tags.map(text => ({ text })),
    brands: meta.brand ? [{ id: meta.brand_id || null, title: meta.brand }] : [],
    related,
    sources: [],
  };
}

// Video detail
// Basic metadata comes from the in-memory search_hvs index (instant).
// For watching, we navigate to the video page and extract:
//   - dl_url  (pixeldrain/direct download link, if present)
//   - related videos from the Vue store
// The HLS stream URL (streamable.cloud) is a private domain that only resolves
// inside the hanime desktop app, so it's not usable here directly.
// The watch page uses the proxy URL to embed the video page with ads stripped.
async function getVideoInfo(slug) {
  const hvs  = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};

  // Open a temporary page to pull Vue store data (fast — reuses existing session)
  await getPage(); // ensure browser is warm
  const vpage = await _browser.newPage();

  await vpage.setRequestInterception(true);
  vpage.on("request", req => {
    const rt = req.resourceType();
    if (["image","font","stylesheet","media"].includes(rt)) req.abort();
    else req.continue();
  });

  let storeData = {};
  try {
    await vpage.goto("https://hanime.tv/videos/hentai/" + slug, {
      waitUntil: "domcontentloaded",
      timeout:   20000,
    });
    // Wait for Vue store to populate; avoids a fixed sleep on fast loads.
    await vpage.waitForFunction(
      `(() => {
        function findS(vm, d) {
          if (d > 5 || !vm) return null;
          if (vm.$S) return vm.$S;
          for (var i = 0; i < (vm.$children || []).length; i++) {
            var r = findS(vm.$children[i], d + 1);
            if (r) return r;
          }
          return null;
        }
        var app = document.querySelector("#app");
        var vue = app && app.__vue__;
        var S = vue && findS(vue, 0);
        return !!(S && S.data && S.data.video && S.data.video.hentai_video);
      })()`,
      { timeout: 8000 }
    ).catch(() => {});

    storeData = await vpage.evaluate(function() {
      function findS(vm, d) {
        if (d > 5 || !vm) return null;
        if (vm.$S) return vm.$S;
        for (var i = 0; i < (vm.$children||[]).length; i++) {
          var r = findS(vm.$children[i], d+1);
          if (r) return r;
        }
        return null;
      }
      var vue = document.querySelector("#app").__vue__;
      if (!vue) return {};
      var S = findS(vue, 0);
      var vd = S && S.data && S.data.video;
      if (!vd) return {};
      var relatedRaw = vd.hentai_franchise_hentai_videos || [];
      return {
        dl_url: vd.dl_url || null,
        related: relatedRaw.slice(0, 16).map(function(v) {
          return { id: v.id, slug: v.slug, name: v.name, cover_url: v.cover_url, views: v.views };
        }),
        tags: (vd.hentai_tags || []).map(function(t) { return { id: t.id, text: t.text }; }),
        brands: (vd.hentai_brands || []).map(function(b) { return { id: b.id, title: b.title }; }),
        description: vd.hentai_video && vd.hentai_video.description || null,
        likes: vd.hentai_video && vd.hentai_video.likes || 0,
        dislikes: vd.hentai_video && vd.hentai_video.dislikes || 0,
      };
    }).catch(() => ({}));
  } catch(_) { /* timeouts are ok */ }

  await vpage.close();

  // Build sources list from the downloadable MP4 when available.
  const sources = [];
  if (storeData.dl_url) {
    const pdId = pixeldrainId(storeData.dl_url);
    const localUrl = pdId ? `/api/hanime/pixeldrain/${encodeURIComponent(pdId)}` : storeData.dl_url;
    const downloadName = encodeURIComponent((storeData.hentai_video && storeData.hentai_video.name) || card.title || slug);
    sources.push({
      server:    "pixeldrain",
      url:       localUrl,
      downloadUrl: pdId ? `/api/hanime/pixeldrain/${encodeURIComponent(pdId)}/watermarked?name=${downloadName}` : storeData.dl_url,
      quality:   "HD Download",
      kind:      pdId ? "mp4" : "direct",
      extension: pdId ? "mp4" : null,
      sizeMB:    null,
    });
  }

  const related = (storeData.related || [])
    .filter(v => v.slug !== slug)
    .map(v => ({
      id:     v.id,
      slug:   v.slug,
      title:  v.name,
      poster: v.cover_url || null,
      views:  v.views     || 0,
      tags:   [],
    }));

  // Supplement with HVS data for related if store gave nothing
  if (related.length === 0) {
    const tags = (meta.tags || []).map(t => typeof t === "string" ? t : (t.text || "")).filter(Boolean);
    hvs
      .filter(v => v.slug !== slug && tags.some(t => (v.tags||[]).some(vt => (typeof vt === "string" ? vt : vt.text) === t)))
      .sort((a, b) => (b.views||0) - (a.views||0))
      .slice(0, 12)
      .forEach(v => related.push(parseCard(v)));
  }

  return {
    id:          meta.id       || null,
    slug,
    title:       meta.name     || slug,
    description: storeData.description || meta.description || null,
    poster:      meta.cover_url || null,
    views:       meta.views    || 0,
    likes:       storeData.likes    || meta.likes    || 0,
    dislikes:    storeData.dislikes || 0,
    duration:    meta.duration_in_ms ? Math.round(meta.duration_in_ms / 1000) : null,
    createdAt:   meta.created_at || null,
    tags:   storeData.tags   || (meta.tags   || []).map(t => ({ text: typeof t === "string" ? t : t.text })),
    brands: storeData.brands || (meta.brand ? [{ title: meta.brand }] : []),
    sources,
    related,
  };
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
