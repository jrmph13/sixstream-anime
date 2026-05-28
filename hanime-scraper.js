/**
 * hanime-scraper.js
 *
 * Browse/search uses Hanime's public search_hvs endpoint.
 * Video detail uses the same guest manifest endpoint as Hanime's player:
 * /api/v8/guest/videos/{id}/manifest. That endpoint returns real
 * highwinds-cdn HLS streams. We intentionally avoid the streamable.cloud
 * placeholder URL because it causes HLS errors outside Hanime's player.
 */

const axios = require("axios");
const axiosRetry = require("axios-retry").default;

const client = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://hanime.tv/",
    "Origin": "https://hanime.tv",
    "x-csrf-token": "",
    "x-session-token": "",
    "x-license": "",
    "x-user-license": "",
    "x-signature-version": "web2",
    "x-signature": "",
    "x-time": "0",
  },
  decompress: true,
  timeout: 30000,
});
axiosRetry(client, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const HVS_URL = "https://cached.freeanimehentai.net/api/v10/search_hvs";
const HVS_TTL = 30 * 60 * 1000;

let _hvs = null;
let _hvsTime = 0;
let _browser = null;
let _sigPage = null;

function parseCard(v) {
  if (!v) return null;
  return {
    id: v.id || null,
    slug: v.slug || null,
    title: v.name || v.title || null,
    poster: v.cover_url || v.poster_url || null,
    views: v.views || 0,
    likes: v.likes || 0,
    duration: v.duration_in_ms ? Math.round(v.duration_in_ms / 1000) : null,
    tags: (v.tags || []).map(t => typeof t === "string" ? t : (t.text || "")),
    brands: (v.brands || []).map(b => typeof b === "string" ? b : (b.title || "")),
    brand: v.brand || null,
    createdAt: v.created_at || null,
  };
}

async function getHVS() {
  if (_hvs && Date.now() - _hvsTime < HVS_TTL) return _hvs;
  console.log("[hanime] fetching video index...");
  const res = await client.get(HVS_URL);
  _hvs = Array.isArray(res.data) ? res.data : [];
  _hvsTime = Date.now();
  console.log("[hanime] index loaded:", _hvs.length, "videos");
  return _hvs;
}

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
  const q = query.toLowerCase().trim();

  const results = hvs.filter(v => {
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
    const id = v.brand_id;
    if (name && !brands.has(name)) brands.set(name, { id, title: name });
  });
  return Array.from(brands.values()).sort((a, b) => a.title.localeCompare(b.title));
}

function relatedByTags(hvs, slug, tagTexts, limit = 16) {
  return hvs
    .filter(v => v.slug !== slug && tagTexts.some(t =>
      (v.tags || []).some(vt => (typeof vt === "string" ? vt : vt.text) === t)
    ))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, limit)
    .map(parseCard).filter(Boolean);
}

async function getVideoMeta(slug) {
  const hvs = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};
  const card = parseCard(meta) || { slug, title: slug };
  const tagTexts = (meta.tags || [])
    .map(t => typeof t === "string" ? t : (t.text || ""))
    .filter(Boolean);

  return {
    ...card,
    description: meta.description || null,
    tags: tagTexts.map(text => ({ text })),
    brands: meta.brand ? [{ id: meta.brand_id || null, title: meta.brand }] : [],
    franchise: null,
    related: relatedByTags(hvs, slug, tagTexts, 12),
    sources: [],
  };
}

async function getSignedHeaders() {
  const puppeteer = require("puppeteer");
  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    _browser.on("disconnected", () => {
      _browser = null;
      _sigPage = null;
    });
  }

  if (!_sigPage || _sigPage.isClosed()) {
    _sigPage = await _browser.newPage();
    await _sigPage.setRequestInterception(true);
    _sigPage.on("request", req => {
      if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await _sigPage.goto("https://hanime.tv/home", { waitUntil: "domcontentloaded", timeout: 25000 });
  }

  await _sigPage.waitForFunction("window.stime > 0 && window.ssignature", { timeout: 15000 }).catch(() => {});
  const auth = await _sigPage.evaluate(() => ({
    sig: window.ssignature || "",
    time: window.stime || 0,
  }));

  return {
    ...client.defaults.headers.common,
    "x-signature": auth.sig,
    "x-time": String(auth.time),
  };
}

async function getVideoInfo(slug) {
  const hvs = await getHVS();
  const meta = hvs.find(v => v.slug === slug) || {};
  const card = parseCard(meta) || { slug, title: slug };
  const tagTexts = (meta.tags || [])
    .map(t => typeof t === "string" ? t : (t.text || ""))
    .filter(Boolean);

  const sources = [];
  let sourceError = null;
  if (meta.id) {
    try {
      const manifestRes = await client.get(
        `https://cached.freeanimehentai.net/api/v8/guest/videos/${meta.id}/manifest`,
        { headers: await getSignedHeaders(), timeout: 15000 }
      );
      const servers = manifestRes.data?.videos_manifest?.servers || [];
      for (const server of servers) {
        for (const stream of (server.streams || [])) {
          if (!stream.url) continue;
          if (stream.kind === "premium_alert" || stream.kind === "member_alert") continue;
          if (stream.url.includes("streamable.cloud")) continue;

          sources.push({
            server: server.name || server.slug || "hanime",
            url: stream.url,
            quality: stream.height ? `${stream.height}p` : "auto",
            kind: stream.kind || (stream.url.includes(".m3u8") ? "hls" : "mp4"),
            extension: stream.extension || null,
            sizeMB: stream.filesize_mbs || null,
          });
        }
      }
      sources.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    } catch (e) {
      sourceError = e.message || "manifest scrape failed";
      console.error("[hanime] manifest error:", e.stack || e.message);
    }
  }

  return {
    ...card,
    description: meta.description || null,
    tags: tagTexts.map(text => ({ text })),
    brands: meta.brand ? [{ id: meta.brand_id || null, title: meta.brand }] : [],
    franchise: null,
    sources,
    sourceError,
    related: relatedByTags(hvs, slug, tagTexts, 16),
  };
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
    _sigPage = null;
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
