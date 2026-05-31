const express = require("express");
const axios = require("axios");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const {
  getHome,
  getLatestUpdated,
  getMostViewed,
  searchAnime,
  getAnimeInfo,
  getEpisodes,
  getServers,
  getVideoSource,
  getGenres,
  getGenreAnime,
  getTypeAnime,
  getStatusAnime,
  getPlayerSources,
} = require("./scraper");

let hanimeScraper;
const hanime = () => {
  if (!hanimeScraper) hanimeScraper = require("./hanime-scraper");
  return hanimeScraper;
};
const getTrending = (...args) => hanime().getTrending(...args);
const getNew = (...args) => hanime().getNew(...args);
const browse = (...args) => hanime().browse(...args);
const searchHentai = (...args) => hanime().searchHentai(...args);
const getTags = (...args) => hanime().getTags(...args);
const getBrands = (...args) => hanime().getBrands(...args);
const getVideoMeta = (...args) => hanime().getVideoMeta(...args);
const getVideoInfo = (...args) => hanime().getVideoInfo(...args);
const closeBrowser = async () => {
  if (hanimeScraper) await hanimeScraper.closeBrowser();
};

const app = express();
app.set("trust proxy", true);
const PORT = process.env.PORT || 3000;
const ACCESS_LIST_URL = process.env.ACCESS_LIST_URL || Buffer.from(
  "aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2pybXBoMTMva2Fid2VuYmR2bndvYm53L3JlZnMvaGVhZHMvbWFpbi9hY2Nlc3MudHh0",
  "base64"
).toString("utf8");

const API_PASS   = process.env.API_PASS || "jrmphpogi ko13aila";
const GROQ_KEY   = "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";
const TG_TOKEN   = "8842418430:AAGb7rvW7_7IpHxJj8I4pNtFoAP-bPaWbgc";
const TG_CHAT_ID = "6187159572";

const normalizeOrigin = (value = "") => {
  const raw = String(value).trim();
  if (!raw || raw.startsWith("#")) return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
};

function publicOrigin(req) {
  const host = req.get("x-forwarded-host") || req.get("host");
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  let proto = forwardedProto || req.protocol || "http";
  if (host && !host.includes("localhost") && !host.startsWith("127.0.0.1")) proto = "https";
  return `${proto}://${host}`;
}

const defaultAllowedOrigins = [
  normalizeOrigin("http://6stream.vercel.app/"),
  normalizeOrigin("https://6stream.vercel.app/"),
  normalizeOrigin("http://localhost:3000/"),
  normalizeOrigin("https://6stream.onrender.com/"),
  normalizeOrigin("https://sixstream.onrender.com/"),
];

let allowedOrigins = new Set(defaultAllowedOrigins);
let accessListLoaded = false;
let accessListFetchedAt = 0;

async function refreshAllowedOrigins() {
  try {
    const { data } = await axios.get(ACCESS_LIST_URL, {
      responseType: "text",
      timeout: 10000,
      headers: { "User-Agent": "6stream-api/1.0" },
    });
    const next = String(data)
      .split(/\r?\n/)
      .map(normalizeOrigin)
      .filter(Boolean);
    if (next.length) {
      allowedOrigins = new Set([...defaultAllowedOrigins, ...next]);
      accessListLoaded = true;
      accessListFetchedAt = Date.now();
    }
  } catch (err) {
    if (!accessListLoaded) console.warn("[cors] access list unavailable; using cached rules");
  }
}

if (require.main === module) {
  refreshAllowedOrigins();
  setInterval(refreshAllowedOrigins, 5 * 60 * 1000).unref();
}

// Shared Groq helper (used by web chat and Telegram bot)
async function groqChat(message, history = []) {
  const r = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are an anime expert AI assistant for 6stream. Help users find anime to watch, give recommendations, explain plots and characters. Be friendly and enthusiastic. Keep replies under 180 words. Use emojis.",
      },
      ...history.slice(-8),
      { role: "user", content: message },
    ],
    max_tokens: 300,
    temperature: 0.7,
  }, {
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return r.data.choices[0].message.content;
}

app.use((req, res, next) => {
  // Telegram webhook bypasses CORS — Telegram sends no Origin header
  if (req.path === "/api/tg-webhook") return next();

  if (Date.now() - accessListFetchedAt > 5 * 60 * 1000) {
    refreshAllowedOrigins();
  }

  const hasValidPass = req.query.apipass === API_PASS || req.headers['x-api-pass'] === API_PASS;

  const origin = normalizeOrigin(req.headers.origin);
  const refererOrigin = normalizeOrigin(req.headers.referer);
  const requestOrigin = origin || refererOrigin;
  const allowed = !requestOrigin || allowedOrigins.has(requestOrigin) || hasValidPass;

  if (req.path.startsWith("/api") && !requestOrigin && !hasValidPass) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (requestOrigin && !allowed) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (origin) {
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header("Vary", "Origin");
  } else if (hasValidPass) {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "SAMEORIGIN");
  res.header("Referrer-Policy", "same-origin");
  res.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
  res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get("/favicon.ico", (_req, res) => res.status(204).end());

// Serve test.html at root
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "test.html"), "utf8")
    .replace(
      "</head>",
      `<script>window.SIXSTREAM_API_PASS=${JSON.stringify(API_PASS)};</script></head>`
    );
  res.type("html").send(html);
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const jsonCache = new Map();
const cacheGet = (key) => {
  const hit = jsonCache.get(key);
  if (!hit || Date.now() > hit.expires) {
    jsonCache.delete(key);
    return null;
  }
  return hit.data;
};
const cacheSet = (key, data, ttlMs) => {
  jsonCache.set(key, { data, expires: Date.now() + ttlMs });
  return data;
};

// ── Docs ──────────────────────────────────────────────────────────────────────
app.get("/api", (req, res) => {
  res.json({
    name: "6stream Scraper API",
    source: "https://anisuge.se",
    endpoints: [
      "GET  /api/home",
      "GET  /api/latest?page=1",
      "GET  /api/popular?page=1",
      "GET  /api/search?q=<query>",
      "GET  /api/genres",
      "GET  /api/genre/:genreId?page=1",
      "GET  /api/type/:type?page=1          (tv|movie|ova|ona|special|music)",
      "GET  /api/status/:status?page=1      (currently-airing|finished-airing|not-yet-aired)",
      "GET  /api/anime/:slug                (anime info + numericId)",
      "GET  /api/anime/:slug/episodes       (requires numericId in query OR auto-fetches)",
      "GET  /api/servers?key=<serverKey>    (serverKey = episode data-ids from episode list)",
      "GET  /api/source/:linkId             (video source URL from a server linkId)",
      "── Hanime.tv ──",
      "GET  /api/hanime                     (hanime docs)",
      "GET  /api/hanime/trending",
      "GET  /api/hanime/new",
      "GET  /api/hanime/browse?tags=&brands=&ordering=",
      "GET  /api/hanime/search?q=",
      "GET  /api/hanime/tags",
      "GET  /api/hanime/brands",
      "GET  /api/hanime/meta/:slug",
      "GET  /api/hanime/video/:slug",
    ],
    flow: [
      "1. GET /api/anime/:slug              → get numericId",
      "2. GET /api/anime/:slug/episodes     → get episodes list (each has epId, serverKey)",
      "3. GET /api/servers?key={serverKey}  → get server list (each has linkId, name, type)",
      "4. GET /api/source/:linkId           → get final video stream URL",
    ],
  });
});

// ── Video Proxy (strips popup/redirect ads) ───────────────────────────────────
app.get("/api/proxy", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, message: "url param required" });

  const srcRes = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://anisuge.se/",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
      "Accept-Language": "en-US,en;q=0.9",
    },
    responseType: "text",
    maxRedirects: 5,
    timeout: 15000,
  });

  const urlObj = new URL(url);
  const origin = urlObj.origin;
  const hostname = urlObj.hostname;

  // Injected before ALL other scripts — kills ads before they load
  const adKiller = `<script>
(function(){
  var AD_HOSTS=['claimedpasquil','popads','popcash','propellerads','adsterra','hilltopads',
    'exosrv','onclicka','trafficjunky','juicyads','plugrush','realsrv','adinplay',
    'googlesyndication','doubleclick','outbrain','taboola','mgid','revcontent','statlytic'];

  function isAd(u){
    if(!u||typeof u!=='string') return false;
    if(/^(\/|#|blob:|data:|javascript:)/.test(u)) return false;
    try{ var h=new URL(u,'https://${hostname}/').hostname;
      return h!=='${hostname}' && !h.endsWith('.${hostname}'); }catch(e){ return false; }
  }

  // 1. Block window.open
  window.open=function(){ return {close:function(){},closed:true,focus:function(){}}; };
  window.openNew=window.open;

  // 2. Block location.assign / replace (safe — no href property override to avoid stack overflow)
  try{
    var origAssign=window.location.assign.bind(window.location);
    var origReplace=window.location.replace.bind(window.location);
    window.location.assign =function(u){ if(!isAd(u)) origAssign(u); };
    window.location.replace=function(u){ if(!isAd(u)) origReplace(u); };
  }catch(e){}

  // 3. Intercept createElement to block ad scripts before src is set
  var _ce=document.createElement.bind(document);
  document.createElement=function(tag){
    var el=_ce(tag);
    if((tag+'').toLowerCase()==='script'){
      var d=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
      if(d&&d.set){
        Object.defineProperty(el,'src',{
          get:function(){ return d.get.call(this); },
          set:function(v){
            if(v&&AD_HOSTS.some(function(h){ return v.includes(h); })){
              console.log('[AdBlock] script blocked:',v); return;
            }
            d.set.call(this,v);
          },
          configurable:true
        });
      }
    }
    return el;
  };

  // 4. Block ad link clicks — capture phase runs before player click handlers
  document.addEventListener('click',function(e){
    var el=e.target;
    for(var i=0;i<6&&el;i++,el=el.parentElement){
      if(el.tagName==='A'&&el.href&&isAd(el.href)){
        e.preventDefault();e.stopImmediatePropagation();
        console.log('[AdBlock] link blocked:',el.href);
        return;
      }
    }
  },true);

  // 5. Block transparent full-screen overlay anchors added dynamically
  var _obs=new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1) return;
        // Only target <a> tags or divs with very high z-index AND no real content
        if(n.tagName==='A' && isAd(n.href||'')){
          n.href='javascript:void(0)';
          console.log('[AdBlock] ad anchor neutralised');
        }
        var z=parseInt((n.style&&n.style.zIndex)||0);
        if(z>999999){ n.remove(); console.log('[AdBlock] overlay removed'); }
      });
    });
  });
  document.addEventListener('DOMContentLoaded',function(){
    if(document.body) _obs.observe(document.body,{childList:true,subtree:true});
  });
  // Also run once body is ready
  if(document.readyState!=='loading' && document.body){
    _obs.observe(document.body,{childList:true,subtree:true});
  }
})();
</script>`;

  let html = srcRes.data;

  // Inject base tag + ad killer right after <head>
  const inject = `<base href="${origin}/">${adKiller}`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + inject);
  } else {
    html = inject + html;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.send(html);
}));

// ── Browse ─────────────────────────────────────────────────────────────────────
// GET /api/all — scrapes all major sections in parallel and returns everything
app.get("/api/all", wrap(async (req, res) => {
  const key = "all:home";
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  const [home, latest, popular] = await Promise.all([
    getHome().catch(() => null),
    getLatestUpdated(1).catch(() => []),
    getMostViewed(1).catch(() => []),
  ]);
  const payload = {
    success: true,
    data: {
      featured: home?.featured || [],
      recent: home?.recent || [],
      latest,
      popular,
      genres: [],
    },
  };
  res.json(cacheSet(key, payload, 2 * 60 * 1000));
}));

app.get("/api/home", wrap(async (req, res) => {
  const cached = cacheGet("home");
  if (cached) return res.json(cached);
  const data = await getHome();
  res.json(cacheSet("home", { success: true, data }, 2 * 60 * 1000));
}));

app.get("/api/latest", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const key = `latest:${page}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const data = await getLatestUpdated(page);
  res.json(cacheSet(key, { success: true, page, total: data.length, data }, 2 * 60 * 1000));
}));

app.get("/api/popular", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const key = `popular:${page}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const data = await getMostViewed(page);
  res.json(cacheSet(key, { success: true, page, total: data.length, data }, 2 * 60 * 1000));
}));

// ── Search ────────────────────────────────────────────────────────────────────
app.get("/api/search", wrap(async (req, res) => {
  const q = (req.query.q || req.query.query || "").trim();
  if (!q) return res.status(400).json({ success: false, message: "Query param 'q' is required." });
  const data = await searchAnime(q);
  res.json({ success: true, query: q, total: data.length, data });
}));

// ── Genres / Types / Status ───────────────────────────────────────────────────
app.get("/api/genres", wrap(async (req, res) => {
  const data = await getGenres();
  res.json({ success: true, total: data.length, data });
}));

app.get("/api/genre/:genreId", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await getGenreAnime(req.params.genreId, page);
  res.json({ success: true, genre: req.params.genreId, page, total: data.length, data });
}));

app.get("/api/type/:type", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await getTypeAnime(req.params.type, page);
  res.json({ success: true, type: req.params.type, page, total: data.length, data });
}));

app.get("/api/status/:status", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await getStatusAnime(req.params.status, page);
  res.json({ success: true, status: req.params.status, page, total: data.length, data });
}));

// ── Anime info ────────────────────────────────────────────────────────────────
app.get("/api/anime/:slug/episodes", wrap(async (req, res) => {
  const { slug } = req.params;
  // numericId can be passed as query param to skip fetching anime info again
  let numericId = req.query.id;
  if (!numericId) {
    const info = await getAnimeInfo(slug);
    numericId = info.numericId;
  }
  if (!numericId) {
    return res.status(404).json({ success: false, message: "Could not resolve anime numeric ID." });
  }
  const data = await getEpisodes(numericId);
  res.json({ success: true, slug, numericId, total: data.length, data });
}));

app.get("/api/anime/:slug", wrap(async (req, res) => {
  const data = await getAnimeInfo(req.params.slug);
  res.json({ success: true, data });
}));

// ── Servers & Sources ─────────────────────────────────────────────────────────

// GET /api/servers?key=<serverKey>
// serverKey is the `data-ids` value on an episode element from episode list
app.get("/api/servers", wrap(async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ success: false, message: "Query param 'key' (episode serverKey) is required." });
  const cacheKey = `servers:${key}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);
  const data = await getServers(key);
  res.json(cacheSet(cacheKey, { success: true, total: data.length, data }, 5 * 60 * 1000));
}));

// GET /api/sources/:slug/:epNum — all servers + embed URLs for an episode in one call
app.get("/api/sources/:slug/:epNum", wrap(async (req, res) => {
  const { slug, epNum } = req.params;
  const info = await getAnimeInfo(slug);
  if (!info.numericId) return res.status(404).json({ success: false, message: "Anime not found" });

  const epList = await getEpisodes(info.numericId);
  const ep = epList.find(e => String(e.epNum) === String(epNum)) || epList[parseInt(epNum) - 1];
  if (!ep) return res.status(404).json({ success: false, message: "Episode not found" });

  const svList = await getServers(ep.serverKey);
  const sources = await Promise.all(svList.map(async sv => {
    try {
      const src = await getVideoSource(sv.linkId);
      return { server: sv.name, type: sv.type, embedUrl: src.url, skipData: src.skipData, linkId: sv.linkId };
    } catch(e) {
      return { server: sv.name, type: sv.type, embedUrl: null, error: e.message, linkId: sv.linkId };
    }
  }));
  res.json({ success: true, anime: info.title, episode: ep.title, epNum: ep.epNum, sources });
}));

// GET /api/source/:linkId
// linkId is the `data-link-id` value on a server element from server list
app.get("/api/source/:linkId", wrap(async (req, res) => {
  const key = `source:${req.params.linkId}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const data = await getVideoSource(req.params.linkId);
  res.json(cacheSet(key, { success: true, data }, 5 * 60 * 1000));
}));

// ── Referer map: CDN host → correct player origin ────────────────────────────
const CDN_REFERERS = [
  { match: ["cinewave", "lostproject"],         ref: "https://megaplay.buzz/" },
  { match: ["watching.onl", "fxpy", "sugevideo"], ref: "https://vidwish.live/"  },
  { match: ["cdn.hanime", "hanime.tv", "highwinds-cdn"], ref: "https://hanime.tv/" },
];
function refererFor(url) {
  try {
    const host = new URL(url).hostname;
    for (const { match, ref } of CDN_REFERERS) {
      if (match.some((m) => host.includes(m))) return ref;
    }
  } catch (_) {}
  return "https://megaplay.buzz/";
}

// ── Simple TTL cache (m3u8 playlists only — segments are never cached) ────────
const m3u8Cache = new Map();
const M3U8_TTL = 60 * 1000; // 1 minute

// ── HLS Proxy ─────────────────────────────────────────────────────────────────
app.get("/api/hls", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("url required");

  const isM3U8req = url.includes(".m3u8");
  const isVttReq  = url.includes(".vtt");
  const hlsPass = (req.query.apipass === API_PASS || req.headers['x-api-pass'] === API_PASS) ? API_PASS : "";
  const hlsCacheKey = `${url}|pass:${hlsPass ? "1" : "0"}`;
  const wantsDownload = req.query.download === "1";
  const cleanDownloadName = String(req.query.name || "source")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110) || "source";
  const setPlaylistDownload = () => {
    if (wantsDownload && isM3U8req) {
      res.setHeader("Content-Disposition", `attachment; filename="6Stream-jhamesmartin-${cleanDownloadName}.m3u8"`);
    }
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", isM3U8req ? "no-cache" : "public, max-age=3600");

  // Return cached m3u8 if fresh
  if (isM3U8req && m3u8Cache.has(hlsCacheKey)) {
    const { text, time } = m3u8Cache.get(hlsCacheKey);
    if (Date.now() - time < M3U8_TTL) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      setPlaylistDownload();
      return res.send(text);
    }
    m3u8Cache.delete(hlsCacheKey);
  }

  const referer = refererFor(url);

  // For m3u8 + vtt: buffer and process text
  if (isM3U8req || isVttReq) {
    const r = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": referer, "Origin": referer.slice(0, -1), "Accept": "*/*",
      },
      responseType: "text",
      timeout: 20000,
    });

    const body = r.data;

    // m3u8 — rewrite all segment/playlist URLs through this proxy
    if (isM3U8req || body.startsWith("#EXTM3U")) {
      const base = url.substring(0, url.lastIndexOf("/") + 1);
      const proxyBase = publicOrigin(req);
      const rewritten = body.replace(/^(?!#)(\S.*)$/gm, (line) => {
        line = line.trim();
        if (!line) return line;
        const abs = line.startsWith("http") ? line : base + line;
        const passQuery = hlsPass ? `&apipass=${encodeURIComponent(hlsPass)}` : "";
        return `${proxyBase}/api/hls?url=${encodeURIComponent(abs)}${passQuery}`;
      });
      m3u8Cache.set(hlsCacheKey, { text: rewritten, time: Date.now() });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      setPlaylistDownload();
      return res.send(rewritten);
    }

    // vtt subtitle
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    return res.send(body);
  }

  // Video segments — stream directly (no buffering) for performance
  const r = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": referer, "Origin": referer.slice(0, -1), "Accept": "*/*",
    },
    responseType: "stream",
    validateStatus: (s) => s >= 200 && s < 500,
    timeout: 30000,
  });

  if (r.status >= 400) {
    res.status(r.status);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(`Upstream segment error ${r.status}`);
  }

  res.status(r.status);
  res.setHeader("Content-Type", "video/MP2T");
  if (r.headers["content-length"]) res.setHeader("Content-Length", r.headers["content-length"]);
  r.data.pipe(res);
}));

// GET /api/hls-download?url=<m3u8>&name=<filename>
// Server fetches every HLS segment via axios (correct Referer), pipes to ffmpeg stdin → MP4.
// This avoids ffmpeg making direct CDN requests which often fail due to missing auth headers.
app.get("/api/hls-download", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url || !String(url).startsWith("http")) {
    return res.status(400).json({ success: false, message: "url required" });
  }
  if (!ffmpegPath) {
    return res.status(500).json({ success: false, message: "ffmpeg-static not available" });
  }

  const cleanName = String(req.query.name || "video")
    .replace(/<[^>]*>/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "video";
  const filename = `6Stream-jhamesmartin-${cleanName}.mp4`;
  const referer = refererFor(url);
  const hdrs = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": referer,
    "Origin": referer.replace(/\/$/, ""),
    "Accept": "*/*",
  };

  // Fetch m3u8, resolve master → variant if needed, collect segment URLs
  let segments;
  try {
    const r = await axios.get(url, { responseType: "text", timeout: 15000, headers: hdrs });
    const body = String(r.data);
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    let lines = body.split(/\r?\n/);

    if (body.includes("EXT-X-STREAM-INF")) {
      // Master playlist — pick first (highest) variant
      const varLine = lines.find(l => l.trim() && !l.startsWith("#"));
      if (!varLine) throw new Error("No variant stream in master playlist");
      const varUrl = varLine.trim().startsWith("http") ? varLine.trim() : base + varLine.trim();
      const vBase = varUrl.substring(0, varUrl.lastIndexOf("/") + 1);
      const vr = await axios.get(varUrl, { responseType: "text", timeout: 15000, headers: hdrs });
      lines = String(vr.data).split(/\r?\n/);
      segments = lines.filter(l => l.trim() && !l.startsWith("#"))
        .map(l => l.trim().startsWith("http") ? l.trim() : vBase + l.trim());
    } else {
      segments = lines.filter(l => l.trim() && !l.startsWith("#"))
        .map(l => l.trim().startsWith("http") ? l.trim() : base + l.trim());
    }
  } catch (e) {
    return res.status(502).json({ success: false, message: `Playlist fetch failed: ${e.message}` });
  }

  if (!segments.length) {
    return res.status(404).json({ success: false, message: "No segments found in playlist." });
  }

  // Stream copy — remux TS→MP4 without re-encoding.
  // Re-encoding (libx264) on Render free tier (0.1 CPU) would take ~7 min for
  // a 12-min episode and timeout. Stream copy is near-instant.
  const ff = spawn(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-f", "mpegts", "-i", "pipe:0",
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-c:a", "aac",     // re-encode audio — avoids aac_adtstoasc silent drop
    "-b:a", "128k",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4", "pipe:1",
  ], { windowsHide: true });

  ff.stdin.on("error", () => {});

  // ── Fix 0-byte issue ──────────────────────────────────────────────────────
  // Do NOT pipe stdout to res directly: pipe calls res.end() when ffmpeg exits
  // (even on error), giving the browser a clean 0-byte file with no error.
  // Instead, send headers only after the first real data chunk arrives.
  let started = false;
  ff.stdout.on("data", (chunk) => {
    if (!started) {
      started = true;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
    }
    res.write(chunk);
  });
  ff.stdout.on("end", () => { if (started && !res.writableEnded) res.end(); });

  let errText = "";
  ff.stderr.on("data", c => { errText += c.toString(); });
  ff.on("error", (err) => {
    if (!started) res.status(500).json({ success: false, message: err.message });
    else if (!res.writableEnded) res.end();
  });
  ff.on("close", (code) => {
    if (!started) {
      // ffmpeg produced nothing — send the actual error so user sees it
      res.status(500).json({ success: false, message: errText.slice(-800) || `ffmpeg exited ${code}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  req.on("close", () => { if (!ff.killed) ff.kill("SIGKILL"); });

  // Stream each TS segment to ffmpeg stdin sequentially
  (async () => {
    try {
      for (const seg of segments) {
        if (ff.killed) break;
        const r = await axios.get(seg, {
          responseType: "stream", timeout: 30000, headers: hdrs,
          validateStatus: s => s < 400,
        });
        await new Promise((resolve, reject) => {
          r.data.on("end", resolve);
          r.data.on("error", reject);
          r.data.pipe(ff.stdin, { end: false });
        });
      }
    } catch (e) {
      console.error("[hls-dl] segment error:", e.message);
    }
    try { ff.stdin.end(); } catch (_) {}
  })();
}));

// GET /api/player?url=<embedUrl>  →  real m3u8 + subtitles from getSources API
app.get("/api/player", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, message: "url param required" });
  const key = `player:${url}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const data = await getPlayerSources(url);
  res.json(cacheSet(key, { success: true, embedUrl: url, ...data }, 5 * 60 * 1000));
}));

// GET /api/stream/:linkId -> embed URL + real HLS sources in one cached call
app.get("/api/stream/:linkId", wrap(async (req, res) => {
  const key = `stream:${req.params.linkId}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const srcData = await getVideoSource(req.params.linkId);
  if (!srcData?.url) throw new Error("No embed URL");
  const player = await getPlayerSources(srcData.url);
  const payload = {
    success: true,
    data: srcData,
    embedUrl: srcData.url,
    sources: player.sources,
    subtitles: player.subtitles,
    intro: player.intro,
    outro: player.outro,
    server: player.server,
  };
  res.json(cacheSet(key, payload, 5 * 60 * 1000));
}));

// GET /api/play/:slug/:epNum?type=sub&server=0
// Full pipeline: anime → episode → embed URL → real m3u8 + subtitles (no browser needed)
app.get("/api/play/:slug/:epNum", wrap(async (req, res) => {
  const { slug, epNum } = req.params;
  const wantType  = req.query.type   || "sub";
  const serverIdx = parseInt(req.query.server ?? 0);

  const info = await getAnimeInfo(slug);
  if (!info.numericId) return res.status(404).json({ success: false, message: "Anime not found" });

  const epList = await getEpisodes(info.numericId);
  const ep     = epList.find(e => String(e.epNum) === String(epNum)) || epList[parseInt(epNum) - 1];
  if (!ep) return res.status(404).json({ success: false, message: "Episode not found" });

  const svList   = await getServers(ep.serverKey);
  const filtered = svList.filter(s => s.type === wantType);
  const sv       = filtered[serverIdx] || filtered[0] || svList[0];
  if (!sv) return res.status(404).json({ success: false, message: "No server found" });

  const srcData  = await getVideoSource(sv.linkId);
  const embedUrl = srcData.url;
  const player   = await getPlayerSources(embedUrl);

  res.json({
    success:   true,
    anime:     info.title,
    episode:   ep.title,
    epNum:     ep.epNum,
    server:    sv.name,
    type:      sv.type,
    embedUrl,
    sources:   player.sources,
    subtitles: player.subtitles,
    intro:     player.intro,
    outro:     player.outro,
  });
}));

// ── Hanime.tv ─────────────────────────────────────────────────────────────────
app.get("/api/hanime", (req, res) => {
  res.json({
    name: "Hanime.tv API",
    source: "https://hanime.tv",
    endpoints: [
      "GET  /api/hanime/trending?page=0&per_page=24",
      "GET  /api/hanime/new?page=0&per_page=24&ordering=created_at_unix",
      "GET  /api/hanime/browse?page=0&per_page=24&tags=tag1,tag2&brands=brand1&ordering=created_at_unix",
      "GET  /api/hanime/search?q=<query>&page=0&per_page=24&tags=tag1,tag2&brands=brand1",
      "GET  /api/hanime/tags",
      "GET  /api/hanime/brands",
      "GET  /api/hanime/meta/:slug     (fast metadata from search index)",
      "GET  /api/hanime/video/:slug    (video detail + clean stream URLs, no ads)",
    ],
    note: "Video sources are direct CDN links — no ads, no redirects.",
  });
});

app.get("/api/hanime/trending", wrap(async (req, res) => {
  const page    = parseInt(req.query.page)     || 0;
  const perPage = parseInt(req.query.per_page) || 24;
  const data = await getTrending(page, perPage);
  res.json({ success: true, page, total: data.length, data });
}));

app.get("/api/hanime/new", wrap(async (req, res) => {
  const page     = parseInt(req.query.page)     || 0;
  const perPage  = parseInt(req.query.per_page) || 24;
  const ordering = req.query.ordering || "created_at_unix";
  const data = await getNew(page, perPage, ordering);
  res.json({ success: true, page, total: data.length, data });
}));

app.get("/api/hanime/browse", wrap(async (req, res) => {
  const page     = parseInt(req.query.page)     || 0;
  const perPage  = parseInt(req.query.per_page) || 24;
  const ordering = req.query.ordering || "created_at_unix";
  const tags     = req.query.tags   ? req.query.tags.split(",").map(t => t.trim()).filter(Boolean)   : [];
  const brands   = req.query.brands ? req.query.brands.split(",").map(b => b.trim()).filter(Boolean) : [];
  const data = await browse({ page, perPage, ordering, tags, brands });
  res.json({ success: true, page, total: data.length, data });
}));

app.get("/api/hanime/search", wrap(async (req, res) => {
  const query   = (req.query.q || req.query.query || "").trim();
  const page    = parseInt(req.query.page)     || 0;
  const perPage = parseInt(req.query.per_page) || 24;
  const tags    = req.query.tags   ? req.query.tags.split(",").map(t => t.trim()).filter(Boolean)   : [];
  const brands  = req.query.brands ? req.query.brands.split(",").map(b => b.trim()).filter(Boolean) : [];
  const data = await searchHentai({ query, page, perPage, tags, brands });
  res.json({ success: true, query, page, total: data.length, data });
}));

app.get("/api/hanime/tags", wrap(async (req, res) => {
  const data = await getTags();
  res.json({ success: true, total: data.length, data });
}));

app.get("/api/hanime/brands", wrap(async (req, res) => {
  const data = await getBrands();
  res.json({ success: true, total: data.length, data });
}));

app.get("/api/hanime/pixeldrain/:id/watermarked", wrap(async (req, res) => {
  if (!ffmpegPath) {
    return res.status(500).json({ success: false, message: "ffmpeg-static is not available." });
  }

  const id = req.params.id;
  const upstream = `https://pixeldrain.com/api/filesystem/${encodeURIComponent(id)}`;
  const font = process.platform === "win32"
    ? "C\\:/Windows/Fonts/arialbd.ttf"
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const watermark = `drawtext=fontfile='${font}':text='6stream':x=w-tw-24:y=24:fontsize=max(28\\,h*0.055):fontcolor=white@0.62:shadowcolor=black@0.85:shadowx=3:shadowy=3`;
  const rawName = String(req.query.name || id)
    .replace(/<[^>]*>/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || id;
  const filename = `6Stream-jhamesmartin-${rawName}.mp4`;

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");

  const ff = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel", "error",
    "-headers", "User-Agent: Mozilla/5.0\r\nAccept: video/mp4,video/*,*/*\r\n",
    "-i", upstream,
    "-vf", watermark,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "copy",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4",
    "pipe:1",
  ], { windowsHide: true });

  ff.stdout.pipe(res);
  let errText = "";
  ff.stderr.on("data", (chunk) => { errText += chunk.toString(); });
  ff.on("error", (err) => {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    else res.destroy(err);
  });
  ff.on("close", (code) => {
    if (code && !res.headersSent) {
      res.status(500).json({ success: false, message: errText || `ffmpeg exited with ${code}` });
    }
  });
  req.on("close", () => {
    if (!ff.killed) ff.kill("SIGKILL");
  });
}));

app.get("/api/hanime/pixeldrain/:id", wrap(async (req, res) => {
  const id = req.params.id;
  const upstream = `https://pixeldrain.com/api/filesystem/${encodeURIComponent(id)}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "video/mp4,video/*,*/*",
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const r = await axios.get(upstream, {
    headers,
    responseType: "stream",
    validateStatus: (s) => s >= 200 && s < 400,
    timeout: 30000,
  });

  res.status(r.status);
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
    if (r.headers[h]) res.setHeader(h, r.headers[h]);
  }
  if (req.query.download === "1") {
    const fallbackName = `${id}.mp4`;
    const original = r.headers["content-disposition"] || "";
    const match = original.match(/filename="([^"]+)"/i);
    const filename = match ? match[1] : fallbackName;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  r.data.pipe(res);
}));

app.get("/api/hanime/meta/:slug", wrap(async (req, res) => {
  const data = await getVideoMeta(req.params.slug);
  res.json({ success: true, data });
}));

app.get("/api/hanime/video/:slug", wrap(async (req, res) => {
  const data = await getVideoInfo(req.params.slug);
  res.json({ success: true, data });
}));

// ── Image proxy (passes Referer so hotlink-protected CDNs return 200) ─────────
app.get("/api/img-proxy", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith("https://")) {
    return res.status(400).send("bad url");
  }
  // Only allow known safe image CDNs
  const allowed = ["hanime-cdn.com","hanime.tv","cdn.hanime","highwinds-cdn.com"];
  const host = (() => { try { return new URL(url).hostname; } catch(_) { return ""; } })();
  if (!allowed.some(h => host.endsWith(h))) {
    return res.status(403).send("forbidden");
  }
  const imgRes = await axios.get(url, {
    responseType: "stream",
    timeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://hanime.tv/",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  res.setHeader("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");
  imgRes.data.pipe(res);
}));

// ── AI Chat (web) ─────────────────────────────────────────────────────────────
app.post("/api/chat", wrap(async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });
  const reply = await groqChat(message, history);
  res.json({ success: true, reply });
}));

// ── Send episode rating + feedback to Telegram ────────────────────────────────
app.post("/api/rate", wrap(async (req, res) => {
  const { rating, anime, episode, feedback } = req.body || {};
  if (!rating) return res.status(400).json({ error: "rating required" });
  const stars = "⭐".repeat(Math.min(4, Math.max(1, parseInt(rating))));
  const text = [
    `${stars} <b>Episode Rated ${rating}/4</b>`,
    ``,
    `📺 <b>${anime || "Unknown Anime"}</b>`,
    `📑 ${episode || "Unknown Episode"}`,
    feedback ? `\n💬 <i>${feedback}</i>` : "",
  ].join("\n");
  await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    chat_id: TG_CHAT_ID, text, parse_mode: "HTML",
  }, { timeout: 10000 });
  res.json({ success: true });
}));

// ── Telegram Bot Webhook ──────────────────────────────────────────────────────
app.post("/api/tg-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.message || req.body?.edited_message;
    if (!msg?.text) return;
    const userId = String(msg.from?.id || "");
    const chatId = msg.chat.id;
    const text   = msg.text.trim();
    const isAdmin = userId === TG_CHAT_ID;

    const send = (t) => axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: chatId, text: t, parse_mode: "HTML",
      disable_web_page_preview: true,
    }, { timeout: 10000 }).catch(() => {});

    if (!isAdmin) return send("🔒 This bot is private.");

    if (text.startsWith("/start")) {
      return send(`👋 <b>6stream Bot</b>\n\nYour personal anime assistant! I'll notify you when you rate episodes and answer anime questions.\n\n/help — see all commands`);
    }
    if (text.startsWith("/help")) {
      return send(`📋 <b>Commands</b>\n\n/recommend — Anime recommendations\n/trending — What's hot right now\n/top10 — Top 10 list\n/search &lt;title&gt; — Info about an anime\n\nOr just type anything! 🎌`);
    }
    if (text.startsWith("/trending")) {
      return send(`📈 <b>Trending</b>\n\nOpen <a href="https://sixstream.onrender.com">6stream</a> → Trending tab for the latest! 🍿`);
    }
    if (text.startsWith("/top10")) {
      return send(`🏆 <b>Top 10</b>\n\nOpen <a href="https://sixstream.onrender.com">6stream</a> and tap <b>Top 10</b> in the nav!`);
    }
    if (text.startsWith("/search") || text.startsWith("/recommend")) {
      const q = text.replace(/^\/(search|recommend)\s*/i, "").trim() || "best anime to watch";
      return send(await groqChat(q, []));
    }
    if (text.startsWith("/")) {
      return send("❓ Unknown command. Use /help.");
    }
    // Free-form message → AI
    send(await groqChat(text, []));
  } catch (_) {}
});

// ── Generic video download proxy (adds Referer so CDNs don't 403) ────────────
app.get("/api/dl", wrap(async (req, res) => {
  const url = req.query.url;
  const name = String(req.query.name || "video.mp4")
    .replace(/[<>"\\/:*?|]+/g, "_")
    .slice(0, 200);
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "url required" });
  }
  const referer = refererFor(url);
  const r = await axios.get(url, {
    responseType: "stream",
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": referer,
      "Origin": referer.replace(/\/$/, ""),
      "Accept": "*/*",
    },
    validateStatus: (s) => s < 500,
  });
  res.status(r.status);
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Type", r.headers["content-type"] || "video/mp4");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (r.headers["content-length"]) res.setHeader("Content-Length", r.headers["content-length"]);
  r.data.pipe(res);
}));

// ── Secret API Docs ───────────────────────────────────────────────────────────
app.get("/jopay/jhames/api/doc/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const ep = (path, desc) =>
    `<div class="ep"><span class="get">GET</span><span class="ep-path">${path}</span><span class="ep-note">${desc}</span></div>`;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>6stream — API Docs</title>
<style>
:root{--bg:#0f0f13;--bg2:#16161e;--bg3:#1e1e2a;--acc:#7c3aed;--acc2:#a855f7;--txt:#e2e8f0;--muted:#94a3b8;--bd:#2a2a3a;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--txt);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;}
code{font-family:'Consolas','Courier New',monospace;}
header{background:var(--bg2);border-bottom:1px solid var(--bd);padding:14px 24px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:9;}
.logo{font-size:1.22rem;font-weight:900;color:var(--acc2);letter-spacing:.04em;}
.logo span{color:var(--txt);}
.pill{padding:2px 9px;border-radius:999px;background:rgba(124,58,237,.18);border:1px solid rgba(168,85,247,.38);color:var(--acc2);font-size:.6rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;}
.by{margin-left:auto;font-size:.75rem;color:var(--muted);}
.by strong{color:var(--txt);}
main{max-width:880px;margin:0 auto;padding:28px 18px;}
.hero{background:linear-gradient(135deg,rgba(124,58,237,.18),rgba(168,85,247,.06));border:1px solid rgba(168,85,247,.28);border-radius:14px;padding:22px 24px;margin-bottom:22px;}
.hero h1{font-size:1.45rem;font-weight:900;margin-bottom:5px;}
.hero p{font-size:.85rem;color:var(--muted);line-height:1.6;}
.auth-card{background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:18px 20px;margin-bottom:22px;}
.card-hd{font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:900;margin-bottom:9px;}
.auth-key{background:rgba(124,58,237,.1);border:1px solid rgba(168,85,247,.25);border-radius:8px;padding:10px 13px;font-size:.81rem;color:#e2e8f0;font-family:monospace;word-break:break-all;margin-bottom:10px;}
.origin-list{display:flex;flex-wrap:wrap;gap:6px;}
.origin-tag{font-size:.67rem;padding:3px 9px;border-radius:5px;background:var(--bg3);border:1px solid var(--bd);color:var(--muted);}
.info-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:22px;}
.info-chip{background:var(--bg2);border:1px solid var(--bd);border-radius:9px;padding:12px 14px;}
.ic-label{font-size:.59rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:900;margin-bottom:4px;}
.ic-val{font-size:.82rem;color:var(--txt);font-weight:600;}
.sec{margin-bottom:24px;}
.sec-title{font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding-bottom:7px;border-bottom:1px solid var(--bd);margin-bottom:9px;}
.ep{background:var(--bg2);border:1px solid var(--bd);border-radius:9px;display:flex;align-items:center;gap:9px;padding:10px 14px;margin-bottom:6px;flex-wrap:wrap;}
.get{font-size:.58rem;font-weight:900;padding:2px 7px;border-radius:4px;background:rgba(16,185,129,.18);color:#6ee7b7;border:1px solid rgba(16,185,129,.35);font-family:monospace;letter-spacing:.04em;white-space:nowrap;flex-shrink:0;}
.ep-path{font-size:.81rem;font-family:monospace;flex:1;color:var(--txt);min-width:0;}
.ep-path .prm{color:#fbbf24;}
.ep-path .qs{color:#7dd3fc;}
.ep-note{font-size:.71rem;color:var(--muted);}
.flow-card{background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.22);border-radius:10px;padding:14px 16px;margin-top:10px;}
.flow-card .fhd{font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:#6ee7b7;font-weight:900;margin-bottom:9px;}
.flow-card ol{padding-left:18px;display:flex;flex-direction:column;gap:5px;}
.flow-card li{font-size:.8rem;color:var(--muted);line-height:1.5;}
.flow-card code{color:#e2e8f0;}
.flow-card .hi{color:#6ee7b7;}
footer{text-align:center;padding:22px;font-size:.72rem;color:var(--muted);border-top:1px solid var(--bd);margin-top:8px;}
footer strong{color:var(--txt);}
@media(max-width:640px){.info-row{grid-template-columns:1fr 1fr;}.ep-note{width:100%;}}
@media(max-width:400px){.info-row{grid-template-columns:1fr;}}
</style>
</head>
<body>
<header>
  <div class="logo">6<span>stream</span></div>
  <span class="pill">API v1</span>
  <div class="by">by <strong>Jhames Martin</strong></div>
</header>
<main>
  <div class="hero">
    <h1>6stream API Documentation</h1>
    <p>Full anime &amp; 18+ scraper API. All routes return JSON. Built by <strong style="color:var(--txt)">Jhames Martin</strong> &mdash; sources: <code>anisuge.se</code> (anime) &amp; <code>hanime.tv</code> (18+).</p>
  </div>

  <div class="auth-card">
    <div class="card-hd">Cross-Domain Auth</div>
    <p style="font-size:.8rem;color:var(--muted);margin-bottom:10px;">Requests from <strong style="color:var(--txt)">unlisted domains</strong> must include <code style="color:#fbbf24">?apipass=&lt;key&gt;</code> on every call.</p>
    <div class="auth-key">GET /api/home?apipass=jrmphpogi ko13aila</div>
  </div>

  <div class="sec">
    <div class="sec-title">General</div>
    ${ep("/api","Short endpoint list")}
    ${ep("/api/all","Home + latest + popular (cached 2 min)")}
    ${ep("/api/home","Featured &amp; recent anime")}
    ${ep('/api/latest<span class="qs">?page=1</span>',"Latest updated anime")}
    ${ep('/api/popular<span class="qs">?page=1</span>',"Most viewed anime")}
    ${ep('/api/search<span class="qs">?q=query</span>',"Search anime by title")}
    ${ep("/api/genres","All genres")}
    ${ep('/api/genre/<span class="prm">:genreId</span><span class="qs">?page=1</span>',"Anime by genre")}
    ${ep('/api/type/<span class="prm">:type</span><span class="qs">?page=1</span>',"tv | movie | ova | ona | special | music")}
    ${ep('/api/status/<span class="prm">:status</span><span class="qs">?page=1</span>',"currently-airing | finished-airing | not-yet-aired")}
  </div>

  <div class="sec">
    <div class="sec-title">Anime Detail &amp; Episodes</div>
    ${ep('/api/anime/<span class="prm">:slug</span>',"Anime info + numericId")}
    ${ep('/api/anime/<span class="prm">:slug</span>/episodes',"Episode list (serverKey per episode)")}
    ${ep('/api/servers<span class="qs">?key=serverKey</span>',"Server list for episode (linkId per server)")}
    ${ep('/api/source/<span class="prm">:linkId</span>',"Embed URL for a server (cached 5 min)")}
    ${ep('/api/sources/<span class="prm">:slug/:epNum</span>',"All servers + embed URLs in one call")}
  </div>

  <div class="sec">
    <div class="sec-title">Stream Pipeline (no browser needed)</div>
    ${ep('/api/stream/<span class="prm">:linkId</span>',"Embed URL + m3u8 + subtitles")}
    ${ep('/api/player<span class="qs">?url=embedUrl</span>',"Real m3u8 + subtitles from embed URL")}
    ${ep('/api/play/<span class="prm">:slug/:epNum</span><span class="qs">?type=sub&amp;server=0</span>',"Full pipeline in one call")}
    <div class="flow-card">
      <div class="fhd">Flow Guide</div>
      <ol>
        <li><code>GET /api/anime/:slug</code> &rarr; get <code>numericId</code></li>
        <li><code>GET /api/anime/:slug/episodes</code> &rarr; get episode list &rarr; each has <code>serverKey</code></li>
        <li><code>GET /api/servers?key={serverKey}</code> &rarr; get servers &rarr; each has <code>linkId</code></li>
        <li><code>GET /api/source/:linkId</code> &rarr; get embed URL</li>
        <li><code>GET /api/player?url={embedUrl}</code> &rarr; get m3u8 + subtitles</li>
        <li class="hi">OR &mdash; <code>GET /api/play/:slug/:epNum</code> does steps 1&ndash;5 in one call</li>
      </ol>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Proxy &amp; Utility</div>
    ${ep('/api/proxy<span class="qs">?url=pageUrl</span>',"Embed page with ad-blocker injected")}
    ${ep('/api/hls<span class="qs">?url=m3u8Url</span>',"HLS proxy — rewrites all segment URLs")}
    ${ep('/api/hls<span class="qs">?url=...&amp;download=1&amp;name=title</span>',"Download m3u8 playlist file")}
    ${ep('/api/hls-download<span class="qs">?url=m3u8&amp;name=title</span>',"Full HLS as downloadable MP4 (ffmpeg)")}
    ${ep('/api/img-proxy<span class="qs">?url=imageUrl</span>',"Image proxy for hanime CDN")}
  </div>

  <div class="sec">
    <div class="sec-title">Hanime.tv (18+)</div>
    ${ep("/api/hanime","Hanime endpoint list")}
    ${ep('/api/hanime/trending<span class="qs">?page=0&amp;per_page=24</span>',"Trending videos")}
    ${ep('/api/hanime/new<span class="qs">?page=0&amp;ordering=created_at_unix</span>',"Newest videos")}
    ${ep('/api/hanime/browse<span class="qs">?tags=...&amp;brands=...&amp;ordering=...</span>',"Browse with filters")}
    ${ep('/api/hanime/search<span class="qs">?q=query&amp;tags=...&amp;brands=...</span>',"Search videos")}
    ${ep("/api/hanime/tags","All tags")}
    ${ep("/api/hanime/brands","All brands / studios")}
    ${ep('/api/hanime/meta/<span class="prm">:slug</span>',"Fast metadata from search index")}
    ${ep('/api/hanime/video/<span class="prm">:slug</span>',"Video detail + clean CDN stream URLs")}
    ${ep('/api/hanime/pixeldrain/<span class="prm">:id</span>',"Proxy Pixeldrain video (Range supported)")}
    ${ep('/api/hanime/pixeldrain/<span class="prm">:id</span><span class="qs">?download=1</span>',"Force-download Pixeldrain video")}
    ${ep('/api/hanime/pixeldrain/<span class="prm">:id</span>/watermarked<span class="qs">?name=title</span>',"Download with 6stream watermark (ffmpeg)")}
  </div>
</main>
<footer>
  <strong>6stream API</strong> &mdash; Built by <strong>Jhames Martin</strong> &nbsp;&middot;&nbsp; Data scraped from public sources
</footer>
</body>
</html>`);
});

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ success: false, message: err.message || "Internal server error" });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route '${req.path}' not found. GET /api for docs.` });
});

module.exports = app;

if (require.main === module) {
  // Register Telegram webhook
  const webhookUrl = `https://sixstream.onrender.com/api/tg-webhook`;
  axios.post(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, { url: webhookUrl })
    .then(() => console.log("[tg] webhook registered"))
    .catch(e => console.warn("[tg] webhook registration failed:", e.message));

  const server = app.listen(PORT, () => {
    console.log(`\n6stream API  -> http://localhost:${PORT}/api`);
    console.log(`Hanime API   -> http://localhost:${PORT}/api/hanime\n`);

    getTrending(0, 1)
      .then(() => console.log("[hanime] prewarm complete"))
      .catch((err) => console.warn("[hanime] prewarm failed:", err.message));
  });

  process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
  process.on("SIGTERM", async () => { await closeBrowser(); process.exit(0); });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[Error] Port ${PORT} is already in use.`);
      console.error(`Run this to free it:  npx kill-port ${PORT}\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}
