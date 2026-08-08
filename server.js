const express = require("express");
const axios = require("axios");
const path = require("path");
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
const admin = require("./admin-manager");

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
const TG_CHAT_ID = "6187159572"; // primary chat — used as the default send target
const TG_ALLOWED_USERS = new Set([TG_CHAT_ID, "8740462305"]);

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
  // Bypass auth for public routes
  if (req.path === "/api/tg-webhook") return next();
  if (req.path === "/api/api/doc/documentation") return next();

  if (Date.now() - accessListFetchedAt > 5 * 60 * 1000) {
    refreshAllowedOrigins();
  }

  const apiKey = admin.extractApiKey(req);
  const hasValidPass = apiKey ? admin.isValidKey(apiKey, API_PASS) : false;
  // sec-fetch-site is set automatically by browsers and cannot be forged by JS.
  // same-origin means the request came from our own page — no secret needed.
  const isSameOrigin = req.headers['sec-fetch-site'] === 'same-origin';

  const origin = normalizeOrigin(req.headers.origin);
  const refererOrigin = normalizeOrigin(req.headers.referer);
  const requestOrigin = origin || refererOrigin;
  const allowed = !requestOrigin || allowedOrigins.has(requestOrigin) || hasValidPass || isSameOrigin;

  if (req.path.startsWith("/api") && !requestOrigin && !hasValidPass && !isSameOrigin) {
    return res.status(403).json({ message: "Dont try to scrape this u gay", status: "blocked", reason: "nice try pero no" });
  }

  if (requestOrigin && !allowed) {
    return res.status(403).json({ message: "Dont try to scrape this u gay", status: "blocked", reason: "nice try pero no" });
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

app.use("/assets", express.static(path.join(__dirname, "assets"), {
  maxAge: "7d",
}));

// Serve test.html at root
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "test.html"), "utf8")
    .replace(
      "</head>",
      `<script>window.SIXSTREAM_API_PASS=${JSON.stringify(API_PASS)};</script></head>`
    );
  res.type("html").send(html);
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const APP_TXT_URL = "https://raw.githubusercontent.com/jrmph13/sixstream/refs/heads/main/app.txt";

app.get("/download", wrap(async (req, res) => {
  let downloadUrl = "";
  try {
    const r = await axios.get(APP_TXT_URL, { responseType: "text", timeout: 8000 });
    downloadUrl = String(r.data).trim();
  } catch (_) {}

  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Download 6stream</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f13;font-family:system-ui,sans-serif;color:#e2e8f0;padding:24px;}

/* splash / loader */
#splash{position:fixed;inset:0;background:#0f0f13;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99;transition:opacity .5s ease;}
#splash.hidden{opacity:0;pointer-events:none;}
.splash-logo{width:180px;max-width:70vw;animation:pulse 1.6s ease-in-out infinite;}
.splash-bar{width:180px;max-width:70vw;height:3px;background:#1e1e2a;border-radius:99px;margin-top:28px;overflow:hidden;}
.splash-fill{height:100%;width:0;background:linear-gradient(90deg,#7c3aed,#a855f7);border-radius:99px;animation:load 1.6s ease forwards;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes load{0%{width:0}100%{width:100%}}

/* main card */
.card{background:#16161e;border:1px solid #2a2a3a;border-radius:24px;padding:40px 32px;max-width:400px;width:100%;text-align:center;box-shadow:0 8px 48px rgba(0,0,0,.6);opacity:0;transform:translateY(18px);transition:opacity .5s ease,transform .5s ease;}
.card.show{opacity:1;transform:translateY(0);}
.app-icon{width:90px;height:90px;border-radius:22px;margin:0 auto 20px;display:block;box-shadow:0 4px 24px rgba(124,58,237,.35);}
.logo-img{width:160px;max-width:80%;margin:0 auto 8px;display:block;}
.sub{font-size:.86rem;color:#94a3b8;margin-bottom:28px;line-height:1.65;}
.btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;padding:14px 30px;border-radius:14px;font-size:1rem;font-weight:700;transition:opacity .18s,transform .15s;box-shadow:0 4px 20px rgba(124,58,237,.4);}
.btn:hover{opacity:.88;transform:translateY(-1px);}
.btn:active{transform:translateY(0);}
.btn svg{width:21px;height:21px;fill:currentColor;flex-shrink:0;}
${!downloadUrl ? ".btn{opacity:.38;pointer-events:none;}" : ""}
.note{margin-top:16px;font-size:.72rem;color:#475569;}
</style>
</head>
<body>

<div id="splash">
  <img src="https://i.ibb.co/RG6vBJmR/logo.png" class="splash-logo" alt="6stream"/>
  <div class="splash-bar"><div class="splash-fill"></div></div>
</div>

<div class="card" id="card">
  <img src="https://i.ibb.co/KHyhz4J/app-icon.png" class="app-icon" alt="6stream icon"/>
  <img src="https://i.ibb.co/RG6vBJmR/logo.png" class="logo-img" alt="6stream"/>
  <p class="sub">Watch anime &amp; more &mdash; free, fast, no ads.<br/>Download the Android app below.</p>
  <a class="btn" href="${downloadUrl || "#"}" ${downloadUrl ? 'download' : ''}>
    <svg viewBox="0 0 24 24"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg>
    Download APK
  </a>
  <p class="note">${downloadUrl ? "Android APK &nbsp;&bull;&nbsp; Sideload to install" : "Download link unavailable right now."}</p>
</div>

<script>
  setTimeout(function(){
    var s=document.getElementById('splash');
    var c=document.getElementById('card');
    s.classList.add('hidden');
    setTimeout(function(){ c.classList.add('show'); s.remove(); }, 500);
  }, 1700);
</script>
</body>
</html>`);
}));
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
  res.json(cacheSet(key, { success: true, data }, 45 * 1000));
}));

// ── Referer map: CDN host → correct player origin ────────────────────────────
const CDN_REFERERS = [
  { match: ["cinewave", "lostproject"],         ref: "https://megaplay.buzz/" },
  { match: ["watching.onl", "fxpy", "sugevideo"], ref: "https://vidwish.live/"  },
];
function refererFor(url, explicitRef) {
  if (explicitRef) {
    try {
      const o = new URL(explicitRef);
      return `${o.protocol}//${o.hostname}/`;
    } catch (_) {}
  }
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

  const explicitRef = req.query.ref || "";
  const isM3U8req = url.includes(".m3u8");
  const isVttReq  = url.includes(".vtt");
  const hlsPass = (req.query.apipass === API_PASS || req.headers['x-api-pass'] === API_PASS) ? API_PASS : "";
  const hlsCacheKey = `${url}|ref:${explicitRef}|pass:${hlsPass ? "1" : "0"}`;
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

  const referer = refererFor(url, explicitRef);

  // For m3u8 + vtt: buffer and process text
  if (isM3U8req || isVttReq) {
    let r;
    try {
      r = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": referer, "Origin": referer.slice(0, -1), "Accept": "*/*",
        },
        responseType: "text",
        timeout: 20000,
      });
    } catch (e) {
      const status = e.response?.status || 502;
      res.status(status);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(`Upstream playlist error ${status}: ${e.message}`);
    }

    const body = r.data;

    // m3u8 — rewrite all segment/playlist URLs through this proxy
    if (isM3U8req || body.startsWith("#EXTM3U")) {
      const base = url.substring(0, url.lastIndexOf("/") + 1);
      const proxyBase = publicOrigin(req);
      const refQuery = explicitRef ? `&ref=${encodeURIComponent(explicitRef)}` : "";
      const rewritten = body.replace(/^(?!#)(\S.*)$/gm, (line) => {
        line = line.trim();
        if (!line) return line;
        const abs = line.startsWith("http") ? line : base + line;
        const passQuery = hlsPass ? `&apipass=${encodeURIComponent(hlsPass)}` : "";
        return `${proxyBase}/api/hls?url=${encodeURIComponent(abs)}${passQuery}${refQuery}`;
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
  res.json(cacheSet(key, { success: true, embedUrl: url, ...data }, 45 * 1000));
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
  res.json(cacheSet(key, payload, 45 * 1000));
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

// ── Image proxy (passes Referer so hotlink-protected CDNs return 200) ─────────
app.get("/api/img-proxy", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith("https://")) {
    return res.status(400).send("bad url");
  }
  // Only allow known safe image CDNs
  const allowed = [];
  const host = (() => { try { return new URL(url).hostname; } catch(_) { return ""; } })();
  if (!allowed.some(h => host.endsWith(h))) {
    return res.status(403).json({ message: "Dont try to scrape this u gay", status: "blocked", reason: "nice try pero no" });
  }
  const imgRes = await axios.get(url, {
    responseType: "stream",
    timeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  res.setHeader("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");
  imgRes.data.pipe(res);
}));


// ── Admin: API Key Management & Dashboard ─────────────────────────────────────
//
// IMPORTANT: These routes use the master password `jrmphpogi ko13aila` for admin
// access. Encrypted child keys (generated via the dashboard) do NOT grant admin
// access — only the master admin password can access the dashboard.

// Helper for dashboard template
function escapeHtml(str) {
  if (typeof str !== "string") str = String(str || "");
  return str
    .replace(new RegExp("[&]", "g"), "&" + "amp;")
    .replace(new RegExp("[<]", "g"), "&" + "lt;")
    .replace(new RegExp("[>]", "g"), "&" + "gt;")
    .replace(new RegExp('["]', "g"), "&" + "quot;")
    .replace(new RegExp("[']", "g"), "&#" + "39;");
}

// Middleware: check for banned keys on ALL /api routes
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  const apiKey = admin.extractApiKey(req);
  if (apiKey && admin.isKeyBanned(apiKey)) {
    return res.status(403).json({ message: "Access denied: API key has been banned", status: "banned" });
  }
  next();
});

// Middleware: track API usage for authenticated requests
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  // Only track after middleware has authenticated
  const apiKey = admin.extractApiKey(req);
  if (apiKey && admin.isValidKey(apiKey, API_PASS)) {
    // Pass the master password so it can identify admin vs child key usage
    admin.trackUsage(apiKey, req, API_PASS);
  }
  next();
});

// Admin Dashboard — hidden route
// GET /route/pogi/si/jhames/admin/dashboard
// Requires: ?apipass=jrmphpogi ko13aila (master password only, encrypted keys won't work)
app.get("/route/pogi/si/jhames/admin/dashboard", (req, res) => {
  const apiKey = admin.extractApiKey(req);
  const isAdmin = apiKey === API_PASS;

  if (!apiKey || !isAdmin) {
    return res.status(401).json({ message: "Access denied. Master admin password required.", status: "unauthorized" });
  }

  const data = admin.getDashboardStats();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>6stream — Admin Dashboard</title>
<style>
:root{--bg:#0f0f13;--bg2:#16161e;--bg3:#1e1e2a;--acc:#7c3aed;--acc2:#a855f7;--txt:#e2e8f0;--muted:#94a3b8;--bd:#2a2a3a;--green:#6ee7b7;--red:#f87171;--yellow:#fbbf24;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--txt);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;font-size:14px;}
code{font-family:'Consolas','Courier New',monospace;background:rgba(124,58,237,.12);padding:1px 5px;border-radius:3px;}
input,select,button,textarea{font-family:inherit;font-size:inherit;}
header{background:var(--bg2);border-bottom:1px solid var(--bd);padding:14px 22px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:99;}
.logo{font-size:1.15rem;font-weight:900;color:var(--acc2);letter-spacing:.04em;}
.logo span{color:var(--muted);font-weight:400;}
.hd-nav{margin-left:auto;display:flex;gap:8px;align-items:center;}
.hd-nav a{color:var(--muted);text-decoration:none;font-size:.78rem;padding:4px 10px;border-radius:6px;border:1px solid var(--bd);transition:.12s;}
.hd-nav a:hover{color:var(--txt);border-color:var(--acc2);}
.container{max-width:1200px;margin:0 auto;padding:22px 16px;}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;}
.card{background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:16px 18px;}
.card-hd{font-size:.6rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:5px;}
.card-val{font-size:1.45rem;font-weight:900;}
.card-val.green{color:var(--green);}
.card-val.purple{color:var(--acc2);}
.card-val.yellow{color:var(--yellow);}
.card-val.red{color:var(--red);}
.section{margin-bottom:26px;}
.section-title{font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding-bottom:8px;border-bottom:1px solid var(--bd);margin-bottom:12px;display:flex;align-items:center;gap:10px;}
.section-title button{background:var(--acc);border:none;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;font-size:.7rem;}
.section-title button:hover{opacity:.85;}
.section-title .badge{font-size:.6rem;background:var(--bg3);padding:2px 8px;border-radius:99px;color:var(--muted);}

/* Table */
.tbl{width:100%;border-collapse:collapse;}
.tbl th{text-align:left;font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--bd);white-space:nowrap;}
.tbl td{padding:8px 10px;border-bottom:1px solid var(--bg3);font-size:.82rem;vertical-align:middle;}
.tbl tr:hover td{background:rgba(124,58,237,.06);}
.key-label{color:var(--acc2);font-weight:600;}
.key-preview{font-family:monospace;color:var(--muted);font-size:.78rem;}
.ban-btn{background:var(--red);border:none;color:#fff;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:.7rem;font-weight:700;}
.ban-btn:hover{opacity:.82;}
.unban-btn{background:var(--green);color:#000;border:none;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:.7rem;font-weight:700;}
.unban-btn:hover{opacity:.82;}

/* Generate form */
.gen-box{background:var(--bg2);border:1px solid var(--bd);border-radius:12px;padding:18px 20px;margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.gen-box label{font-size:.74rem;color:var(--muted);font-weight:700;}
.gen-box input[type=text]{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:8px 12px;border-radius:6px;min-width:200px;flex:1;}
.gen-box button{background:linear-gradient(135deg,var(--acc),var(--acc2));border:none;color:#fff;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:.82rem;}
.gen-box button:hover{opacity:.85;}
.result-box{display:none;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:14px 18px;margin-top:10px;}
.result-box.show{display:block;}
.result-box .rb-hd{font-size:.68rem;font-weight:900;color:var(--green);margin-bottom:6px;}
.result-box code{display:block;background:rgba(0,0,0,.35);padding:10px 14px;border-radius:6px;font-size:.88rem;word-break:break-all;margin-bottom:6px;color:var(--yellow);}
.result-box .rb-note{font-size:.74rem;color:var(--muted);}

/* Logs */
.log-entry{font-size:.78rem;padding:5px 0;border-bottom:1px solid var(--bg3);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.log-entry .le-time{color:var(--muted);font-size:.68rem;white-space:nowrap;}
.log-entry .le-key{color:var(--acc2);font-family:monospace;font-size:.74rem;}
.log-entry .le-ip{color:var(--muted);font-size:.72rem;font-family:monospace;}
.log-entry .le-ep{color:var(--txt);font-size:.72rem;}
.log-empty{color:var(--muted);font-size:.8rem;padding:14px 0;text-align:center;}

/* Responsive */
@media(max-width:768px){.grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:480px){.grid{grid-template-columns:1fr;}.gen-box{flex-direction:column;align-items:stretch;}}
</style>
</head>
<body>
<header>
  <div class="logo">6<span>stream</span> <span>Admin</span></div>
  <div class="hd-nav">
    <a href="/jopay/jhames/api/doc/">API Docs</a>
    <a href="/">Home</a>
  </div>
</header>
<div class="container">

<div class="grid">
  <div class="card"><div class="card-hd">Active Keys</div><div class="card-val purple">${data.stats.totalKeys}</div></div>
  <div class="card"><div class="card-hd">Banned Keys</div><div class="card-val red">${data.stats.totalBanned}</div></div>
  <div class="card"><div class="card-hd">Total Requests</div><div class="card-val yellow">${data.stats.totalRequests}</div></div>
  <div class="card"><div class="card-hd">Unique IPs</div><div class="card-val green">${data.stats.trackedIps}</div></div>
</div>

<div class="section">
  <div class="section-title">Generate New API Key</div>
  <div class="gen-box">
    <label>Label:</label>
    <input type="text" id="keyLabel" placeholder="e.g., my_app, friend_website, discord_bot" value=""/>
    <button onclick="generateKey()">Generate Key</button>
  </div>
  <div class="result-box" id="resultBox">
    <div class="rb-hd">✅ New API Key Generated</div>
    <code id="generatedKey"></code>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button onclick="copyKey()" style="flex:1;background:var(--acc);border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:700;font-size:.82rem;">📋 Copy</button>
      <button onclick="closeResult()" style="background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:700;font-size:.82rem;">✕ Close</button>
    </div>
    <div class="rb-note" style="margin-top:8px;">This key is encrypted. Give it to users instead of the master password. <strong>Copy it now — it won't be shown again!</strong></div>
  </div>
</div>

<div class="section">
  <div class="section-title">
    Active API Keys
    <span class="badge">${data.stats.totalKeys}</span>
  </div>
  ${Object.keys(data.keys).length ? `
  <table class="tbl">
    <thead><tr>
      <th>Label</th><th>Key</th><th>Created</th><th>Requests</th><th>Last Access</th><th>IPs</th><th>Action</th>
    </tr></thead>
    <tbody>
      ${Object.entries(data.keys).filter(([,k]) => !k.blocked).map(([hash, key]) => {
        const usage = data.keyUsage[hash];
        return `<tr>
          <td class="key-label" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="viewSessions('${hash}')">${escapeHtml(key.label || "unnamed")}</td>
          <td class="key-preview">${escapeHtml(key.keyPrefix || hash.slice(0,8)+'...')}</td>
          <td>${key.created ? new Date(key.created).toLocaleDateString() : "—"}</td>
          <td>${usage ? usage.count : 0}</td>
          <td>${usage && usage.lastAccess ? new Date(usage.lastAccess).toLocaleString() : "—"}</td>
          <td>${usage ? usage.ips.length : 0} ${usage && usage.ips.length ? '('+usage.ips.slice(0,2).join(', ')+(usage.ips.length>2?', ...':'')+')' : ''}</td>
          <td>
            <button class="ban-btn" onclick="banKey('${hash}','Abuse')">Ban</button>
            <button class="del-btn" onclick="deleteKey('${hash}')" style="background:var(--muted);border:none;color:#fff;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:.7rem;font-weight:700;margin-left:4px;">Del</button>
          </td>
        </tr>`; 
      }).join('')}
    </tbody>
  </table>` : `<div class="log-empty">No active keys yet. Generate one above.</div>`}
</div>

<div class="section">
  <div class="section-title">
    Banned Keys
    <span class="badge">${data.stats.totalBanned}</span>
  </div>
  ${data.bannedKeys.length ? `
  <table class="tbl">
    <thead><tr><th>Key Hash</th><th>Reason</th><th>Banned At</th><th>Action</th></tr></thead>
    <tbody>
      ${data.bannedKeys.map(b => `<tr>
        <td class="key-preview">${escapeHtml(b.keyHash)}</td>
        <td>${escapeHtml(b.reason || "No reason")}</td>
        <td>${b.bannedAt ? new Date(b.bannedAt).toLocaleDateString() : "—"}</td>
        <td><button class="unban-btn" onclick="unbanKey('${b.keyHash}')">Unban</button></td>
      </tr>`).join('')}
    </tbody>
  </table>` : `<div class="log-empty">No banned keys.</div>`}
</div>

<div class="section">
  <div class="section-title">
    Recent Usage
    <span class="badge">${data.recentLogs.length}</span>
  </div>
  ${data.recentLogs.length ? data.recentLogs.map(l => `
    <div class="log-entry">
      <span class="le-time">${new Date(l.time).toLocaleString()}</span>
      <span class="le-key">${escapeHtml(l.label)}${l.isAdmin ? ' 👑' : ''}</span>
      <span class="le-ip">${escapeHtml(l.ip)}</span>
      <span class="le-ep">${escapeHtml(l.endpoint)}</span>
      <span style="font-size:.65rem;color:var(--acc2);overflow:hidden;text-overflow:ellipsis;max-width:180px;white-space:nowrap;" title="${escapeHtml(l.callingApp || '')}">📱 ${escapeHtml((l.callingApp || 'direct').slice(0,40))}</span>
      <span style="font-size:.6rem;color:var(--muted);padding:1px 6px;border-radius:3px;background:var(--bg3);">${escapeHtml(l.callerType || 'browser')}</span>
    </div>
  `).join('') : `<div class="log-empty">No usage data yet.</div>`}
</div>

</div>

<script>
function escapeHtml(str){var d=document.createElement('div');d.appendChild(document.createTextNode(str));return d.innerHTML;}

async function generateKey(){
  var label=document.getElementById('keyLabel').value.trim()||'unnamed';
  try{
    var r=await fetch('/api/admin/generate-key?apipass=${encodeURIComponent(API_PASS)}&label='+encodeURIComponent(label));
    var d=await r.json();
    if(d.success){
      document.getElementById('generatedKey').textContent=d.key;
      document.getElementById('resultBox').classList.add('show');
    } else { alert('Error: '+d.message); }
  }catch(e){ alert('Request failed'); }
}

function copyKey(){
  var key=document.getElementById('generatedKey').textContent;
  if(navigator.clipboard){
    navigator.clipboard.writeText(key).then(function(){
      var btn=document.querySelector('.result-box button');
      btn.textContent='✅ Copied!';
      setTimeout(function(){ btn.textContent='📋 Copy'; }, 2000);
    });
  } else {
    var ta=document.createElement('textarea');
    ta.value=key;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('Copied!');
  }
}

function closeResult(){
  document.getElementById('resultBox').classList.remove('show');
  location.reload();
}

async function banKey(hash,reason){
  if(!confirm('Ban this key? All requests with this key will be blocked.')) return;
  try{
    var r=await fetch('/api/admin/ban-key?apipass=${encodeURIComponent(API_PASS)}&hash='+hash+'&reason='+encodeURIComponent(reason||'Abuse'));
    var d=await r.json();
    if(d.success) location.reload();
    else alert('Error: '+d.message);
  }catch(e){ alert('Request failed'); }
}

async function unbanKey(hash){
  if(!confirm('Unban this key?')) return;
  try{
    var r=await fetch('/api/admin/unban-key?apipass=${encodeURIComponent(API_PASS)}&hash='+hash);
    var d=await r.json();
    if(d.success) location.reload();
    else alert('Error: '+d.message);
  }catch(e){ alert('Request failed'); }
}

async function deleteKey(hash){
  if(!confirm('Permanently delete this key? This cannot be undone.')) return;
  try{
    var r=await fetch('/api/admin/delete-key?apipass=${encodeURIComponent(API_PASS)}&hash='+hash);
    var d=await r.json();
    if(d.success) location.reload();
    else alert('Error: '+d.message);
  }catch(e){ alert('Request failed'); }
}

async function viewSessions(hash){
  var modal=document.getElementById('sessionModal');
  var content=document.getElementById('sessionContent');
  content.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);">Loading sessions...</div>';
  modal.style.display='block';
  try{
    var r=await fetch('/api/admin/key-logs?apipass=${encodeURIComponent(API_PASS)}&hash='+hash);
    var d=await r.json();
    if(!d.success) throw new Error(d.message);
    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html+='<div><strong style="color:var(--acc2);font-size:1rem;">'+escapeHtml(d.label)+'</strong>';
    html+=' <span style="color:var(--muted);font-size:.8rem;">('+d.totalLogs+' requests)</span></div>';
    html+='<button onclick="closeSession()" style="background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;">✕ Close</button></div>';
    if(d.logs.length===0){
      html+='<div style="text-align:center;padding:30px;color:var(--muted);">No sessions recorded yet.</div>';
    } else {
      html+='<div style="max-height:400px;overflow-y:auto;">';
      for(var i=0;i<d.logs.length;i++){
        var l=d.logs[i];
        html+='<div style="padding:8px 0;border-bottom:1px solid var(--bg3);font-size:.78rem;">';
        html+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        html+='<span style="color:var(--muted);font-size:.68rem;white-space:nowrap;">'+new Date(l.time).toLocaleString()+'</span>';
        html+='<span style="color:var(--txt);">'+escapeHtml(l.endpoint)+'</span>';
        html+='<span style="color:var(--muted);font-family:monospace;font-size:.72rem;">'+escapeHtml(l.ip)+'</span>';
        if(l.callingApp&&l.callingApp!=='direct'){
          html+='<span style="color:var(--acc2);font-size:.68rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+escapeHtml(l.callingApp)+'">📱 '+escapeHtml(l.callingApp.slice(0,40))+'</span>';
        }
        html+='<span style="font-size:.6rem;color:var(--muted);padding:1px 6px;border-radius:3px;background:var(--bg3);">'+escapeHtml(l.callerType||'browser')+'</span>';
        html+='</div>';
        html+='<div style="font-size:.65rem;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">'+escapeHtml((l.ua||'').slice(0,80))+'</div>';
        html+='</div>';
      }
      html+='</div>';
    }
    content.innerHTML=html;
  }catch(e){
    content.innerHTML='<div style="text-align:center;padding:20px;color:var(--red);">Error: '+escapeHtml(e.message)+'</div>';
  }
}

function closeSession(){
  document.getElementById('sessionModal').style.display='none';
}
</script>

<!-- Session Modal -->
<div id="sessionModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:999;align-items:center;justify-content:center;">
  <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:14px;max-width:700px;width:90%;max-height:80vh;overflow:hidden;padding:20px;box-shadow:0 8px 48px rgba(0,0,0,.6);">
    <div id="sessionContent"></div>
  </div>
</div>
</body>
</html>`);
});

// API: Generate new encrypted key (admin only)
app.get("/api/admin/generate-key", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const label = (req.query.label || "unnamed").trim().slice(0, 40);
  const result = admin.createApiKey(API_PASS, label);
  res.json({ success: true, ...result });
}));

// API: Ban a key by hash (admin only)
app.get("/api/admin/ban-key", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const hash = req.query.hash;
  const reason = req.query.reason || "Banned by admin";
  if (!hash) return res.status(400).json({ success: false, message: "hash required" });
  const result = admin.banKey(hash, reason);
  res.json(result);
}));

// API: Unban a key by hash (admin only)
app.get("/api/admin/unban-key", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const hash = req.query.hash;
  if (!hash) return res.status(400).json({ success: false, message: "hash required" });
  const result = admin.unbanKey(hash);
  res.json(result);
}));

// API: Permanently delete a key by hash (admin only)
app.get("/api/admin/delete-key", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const hash = req.query.hash;
  if (!hash) return res.status(400).json({ success: false, message: "hash required" });
  const result = admin.deleteKey(hash);
  res.json(result);
}));

// API: Dashboard data as JSON (admin only)
app.get("/api/admin/stats", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const data = admin.getDashboardStats();
  res.json({ success: true, ...data });
}));

// API: Get all logs for a specific key hash (admin only)
app.get("/api/admin/key-logs", wrap(async (req, res) => {
  const apiKey = admin.extractApiKey(req);
  if (!apiKey || apiKey !== API_PASS) {
    return res.status(401).json({ success: false, message: "Admin access required" });
  }
  const hash = req.query.hash;
  if (!hash) return res.status(400).json({ success: false, message: "hash required" });
  const data = admin.getDashboardStats();
  // Get all logs filtered by this hash
  const keyLogs = data.recentLogs.filter(l => l.keyHash === hash);
  const keyInfo = data.keys[hash];
  res.json({ success: true, hash, label: keyInfo?.label || "unknown", totalLogs: keyLogs.length, logs: keyLogs });
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

// ── Telegram helpers ──────────────────────────────────────────────────────────
function escMd(t) {
  return String(t ?? "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
async function tgApi(method, body) {
  return axios.post(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, body, { timeout: 15000 });
}
async function tgSend(chatId, text, reply_markup) {
  return tgApi("sendMessage", {
    chat_id: chatId, text, parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  }).catch(e => console.warn("[tg] send:", e.response?.data?.description || e.message));
}
async function tgSendPhoto(chatId, photo, caption, reply_markup) {
  return tgApi("sendPhoto", {
    chat_id: chatId, photo, caption, parse_mode: "MarkdownV2",
    ...(reply_markup ? { reply_markup } : {}),
  }).catch(() => tgSend(chatId, caption, reply_markup));
}
async function streamEp(chatId, slug, epNum) {
  try {
    const info   = await getAnimeInfo(slug);
    const eps    = await getEpisodes(info.numericId);
    const ep     = eps.find(e => String(e.epNum) === String(epNum)) || eps[parseInt(epNum) - 1];
    if (!ep) return tgSend(chatId, `❌ Episode ${escMd(String(epNum))} not found\\.`);

    const svList = await getServers(ep.serverKey);
    const subSvs = svList.filter(s => s.type === "sub");
    const dubSvs = svList.filter(s => s.type === "dub");
    const sv     = subSvs[0] || svList[0];
    if (!sv) return tgSend(chatId, "❌ No server found\\.");

    const srcData = await getVideoSource(sv.linkId);
    const player  = await getPlayerSources(srcData.url);
    const m3u8    = player.sources?.[0]?.url;
    if (!m3u8) return tgSend(chatId, "❌ No stream URL found\\.");

    const proxied = `https://sixstream.onrender.com/api/hls?url=${encodeURIComponent(m3u8)}`;
    const dlUrl   = `https://sixstream.onrender.com/api/hls-download?url=${encodeURIComponent(m3u8)}&name=${encodeURIComponent(`${info.title} Ep ${epNum}`)}`;

    const lines = [
      `▶️ *${escMd(info.title)}*`,
      `📺 Episode *${escMd(String(epNum))}*${ep.title && ep.title !== `Episode ${epNum}` ? ` — ${escMd(ep.title)}` : ""}`,
      `🖥️ Server: ${escMd(sv.name)} \\(${escMd(sv.type)}\\)`,
      `📡 Available: ${escMd(String(subSvs.length))} sub${dubSvs.length ? `, ${escMd(String(dubSvs.length))} dub` : ""} server${svList.length > 1 ? "s" : ""}`,
    ];
    if (player.intro)  lines.push(`⏩ Skip intro: ${escMd(String(player.intro.start))}s – ${escMd(String(player.intro.end))}s`);
    if (player.outro)  lines.push(`⏭️ Skip outro: ${escMd(String(player.outro.start))}s – ${escMd(String(player.outro.end))}s`);
    if (player.subtitles?.length) lines.push(`📝 Subtitles: ${escMd(player.subtitles.map(s => s.label).join(", "))}`);
    lines.push(`\n🔗 Stream \\(paste in VLC / any player\\):\n\`${escMd(proxied)}\``);

    const kb = { inline_keyboard: [[
      { text: "⬇️ Download MP4", url: dlUrl },
      { text: "🌐 Open Web",     url: `https://sixstream.onrender.com/watch/${slug}` },
    ]]};

    if (info.poster) {
      return tgSendPhoto(chatId, info.poster,
        `▶️ *${escMd(info.title)}* — Ep *${escMd(String(epNum))}*\n🖥️ ${escMd(sv.name)}`,
        { inline_keyboard: [[
          { text: "⬇️ Download MP4", url: dlUrl },
          { text: "🌐 Open Web",     url: `https://sixstream.onrender.com/watch/${slug}` },
        ]]}
      ).then(() => tgSend(chatId, lines.join("\n"), kb));
    }
    return tgSend(chatId, lines.join("\n"), kb);
  } catch (e) {
    return tgSend(chatId, `❌ Error: ${escMd(e.message)}`);
  }
}

// ── Telegram Bot Webhook ──────────────────────────────────────────────────────
app.post("/api/tg-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;

    // ── Callback queries (inline button presses) ──────────────────────────────
    if (update.callback_query) {
      const cbq    = update.callback_query;
      const userId = String(cbq.from?.id || "");
      const chatId = cbq.message?.chat?.id;
      await tgApi("answerCallbackQuery", { callback_query_id: cbq.id }).catch(() => {});
      if (!TG_ALLOWED_USERS.has(userId)) return;

      const [type, ...parts] = (cbq.data || "").split("|");
      if (type === "noop") return;

      if (type === "a") {
        const slug = parts[0];
        const info = await getAnimeInfo(slug).catch(() => null);
        if (!info) return tgSend(chatId, "❌ Anime not found\\.");
        const syn = info.synopsis?.slice(0, 280) || "No description\\.";
        const cap = `🎬 *${escMd(info.title)}*\n` +
          (info.titleJP ? `_${escMd(info.titleJP)}_\n` : "") +
          `\n${escMd(syn)}${(info.synopsis?.length || 0) > 280 ? "\\.\\.\\." : ""}\n\n` +
          `📺 *Status:* ${escMd(info.status || "Unknown")}\n` +
          `🏷️ *Genres:* ${escMd((info.genres || []).slice(0, 5).join(", ") || "N/A")}`;
        const kb = { inline_keyboard: [[
          { text: "📋 Episodes", callback_data: `e|${slug}` },
          { text: "🌐 Open Web",  url: `https://sixstream.onrender.com/watch/${slug}` },
        ]]};
        if (info.poster) return tgSendPhoto(chatId, info.poster, cap, kb);
        return tgSend(chatId, cap, kb);
      }

      if (type === "e") {
        const slug = parts[0];
        const info = await getAnimeInfo(slug).catch(() => null);
        if (!info?.numericId) return tgSend(chatId, "❌ Could not load episodes\\.");
        const eps  = await getEpisodes(info.numericId).catch(() => []);
        if (!eps.length) return tgSend(chatId, "❌ No episodes found\\.");
        const shown = eps.slice(0, 50);
        const rows  = [];
        for (let i = 0; i < shown.length; i += 5) {
          rows.push(shown.slice(i, i + 5).map(ep => ({
            text: `Ep ${ep.epNum}`, callback_data: `w|${slug}|${ep.epNum}`,
          })));
        }
        if (eps.length > 50) rows.push([{ text: `+${eps.length - 50} more — use /watch ${slug} <ep>`, callback_data: "noop" }]);
        return tgSend(chatId,
          `📋 *${escMd(info.title)}* — ${escMd(String(eps.length))} episodes\n\nSelect:`,
          { inline_keyboard: rows }
        );
      }

      if (type === "w") {
        const [slug, epNum] = parts;
        await tgSend(chatId, `⏳ Getting stream for Ep *${escMd(epNum)}*\\.\\.\\.`);
        return streamEp(chatId, slug, epNum);
      }

      return;
    }

    // ── Regular messages ──────────────────────────────────────────────────────
    const msg    = update.message || update.edited_message;
    if (!msg?.text) return;
    const userId = String(msg.from?.id || "");
    const chatId = msg.chat.id;
    const text   = msg.text.trim();
    if (!TG_ALLOWED_USERS.has(userId)) return tgSend(chatId, "🔒 This bot is private\\.");

    if (text.startsWith("/start")) {
      return tgSend(chatId,
        `👋 *Welcome to 6stream Bot\\!*\n\nYour personal anime assistant\\.\n\n/help — full command list`,
        { inline_keyboard: [[
          { text: "📱 Download App", url: "https://sixstream.onrender.com/download" },
          { text: "🌐 Open 6stream",  url: "https://sixstream.onrender.com" },
        ]]}
      );
    }

    if (text.startsWith("/help")) {
      return tgSend(chatId,
        `📋 *Commands*\n\n` +
        `*🎬 Anime*\n` +
        `/search \\<title\\> — search anime\n` +
        `/trending — most viewed\n` +
        `/new — latest anime\n` +
        `/watch \\<slug\\> \\<ep\\> — stream episode\n\n` +
        `*🤖 Other*\n` +
        `/recommend \\<query\\> — AI anime picks\n` +
        `/top10 — AI top 10 list\n` +
        `/download — get app APK\n\n` +
        `_Just type anything for AI chat\\!_ 🎌`
      );
    }

    if (text.startsWith("/search ")) {
      const query = text.slice(8).trim();
      if (!query) return tgSend(chatId, "Usage: `/search naruto`");
      await tgSend(chatId, `🔍 Searching *${escMd(query)}*\\.\\.\\.`);
      const results = await searchAnime(query).catch(() => []);
      if (!results.length) return tgSend(chatId, "❌ No results found\\.");
      const rows = results.slice(0, 8).map(r => ([{
        text: `${r.title.slice(0, 33)}${r.type ? ` (${r.type})` : ""}`,
        callback_data: `a|${r.slug}`,
      }]));
      return tgSend(chatId, `🔍 *Results for "${escMd(query)}"*\n\nSelect anime:`, { inline_keyboard: rows });
    }

    if (text === "/trending") {
      await tgSend(chatId, "⏳ Loading\\.\\.\\.");
      const data = await getMostViewed(1).catch(() => []);
      if (!data.length) return tgSend(chatId, "❌ Could not load trending\\.");
      const rows = data.slice(0, 10).map(r => ([{ text: r.title.slice(0, 40), callback_data: `a|${r.slug}` }]));
      return tgSend(chatId, "🔥 *Trending Anime*\n\nSelect:", { inline_keyboard: rows });
    }

    if (text === "/new") {
      await tgSend(chatId, "⏳ Loading\\.\\.\\.");
      const data = await getLatestUpdated(1).catch(() => []);
      if (!data.length) return tgSend(chatId, "❌ Could not load latest\\.");
      const rows = data.slice(0, 10).map(r => ([{ text: r.title.slice(0, 40), callback_data: `a|${r.slug}` }]));
      return tgSend(chatId, "🆕 *Latest Anime*\n\nSelect:", { inline_keyboard: rows });
    }

    if (text.startsWith("/watch ")) {
      const [, slug, epNum] = text.split(/\s+/);
      if (!slug || !epNum) return tgSend(chatId, "Usage: `/watch one\\-piece 1050`");
      await tgSend(chatId, `⏳ Getting stream for Ep *${escMd(epNum)}*\\.\\.\\.`);
      return streamEp(chatId, slug, epNum);
    }

    if (text.startsWith("/download")) {
      let dlUrl = "";
      try { const r = await axios.get(APP_TXT_URL, { responseType: "text", timeout: 8000 }); dlUrl = String(r.data).trim(); } catch (_) {}
      return tgSend(chatId, dlUrl
        ? `📱 *6stream App*\n\n[⬇️ Tap to Download APK](${dlUrl})`
        : `📱 *6stream App*\n\n❌ Link unavailable right now\\.`
      );
    }

    if (text.startsWith("/recommend")) {
      const q = text.replace(/^\/recommend\s*/i, "").trim() || "best anime to watch";
      return tgSend(chatId, escMd(await groqChat(q, [])));
    }

    if (text.startsWith("/top10")) {
      return tgSend(chatId, escMd(await groqChat("Give me a short top 10 best anime list with brief reasons", [])));
    }

    if (text.startsWith("/")) return tgSend(chatId, "❓ Unknown command\\. Use /help\\.");

    // Free text → AI
    return tgSend(chatId, escMd(await groqChat(text, [])));

  } catch (err) {
    console.error("[tg-webhook]", err.message);
  }
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

// ── Public API Documentation (no API key required) ────────────────────────────
app.get("/api/api/doc/documentation", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const FB_LINK = "https://www.facebook.com/jhames.rhonnielle.martin";
  const BASE = `https://sixstream.onrender.com`;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>6stream — API Docs</title>
<style>
:root{--bg:#0f0f13;--bg2:#16161e;--bg3:#1e1e2a;--txt:#e2e8f0;--muted:#94a3b8;--bd:#2a2a3a;--acc:#7c3aed;--acc2:#a855f7;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--txt);font-family:system-ui,sans-serif;font-size:14px;line-height:1.65;}
code{font-family:Consolas,'Courier New',monospace;background:rgba(124,58,237,.1);padding:1px 5px;border-radius:3px;font-size:.84em;}
pre{background:var(--bg3);border:1px solid var(--bd);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:.8rem;color:#e2e8f0;margin:8px 0;line-height:1.5;}
pre .cmt{color:#64748b;}
pre .kw{color:#a855f7;}
pre .str{color:#fbbf24;}
pre .url{color:#38bdf8;}
a{color:var(--acc2);text-decoration:none;}
a:hover{text-decoration:underline;}
header{background:var(--bg2);border-bottom:1px solid var(--bd);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:9;}
.logo{font-size:1.05rem;font-weight:700;color:var(--txt);letter-spacing:.02em;}
.logo span{color:var(--muted);}
.hd-nav{margin-left:auto;display:flex;gap:6px;}
.hd-nav a{color:var(--muted);font-size:.75rem;padding:4px 10px;border-radius:5px;border:1px solid var(--bd);}
.hd-nav a:hover{color:var(--txt);border-color:var(--muted);}
.container{max-width:820px;margin:0 auto;padding:20px 14px;}
h1{font-size:1.35rem;font-weight:700;margin-bottom:4px;}
h2{font-size:1.05rem;font-weight:600;margin:22px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--bd);}
h3{font-size:.9rem;font-weight:600;margin:16px 0 8px;color:var(--txt);}
.hero{border:1px solid var(--bd);border-radius:10px;padding:20px 18px;margin-bottom:18px;text-align:center;}
.hero p{font-size:.85rem;color:var(--muted);margin-top:4px;margin-bottom:14px;}
.get-btn{display:inline-block;background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:10px 24px;border-radius:8px;font-weight:600;font-size:.85rem;}
.get-btn:hover{background:var(--bg2);border-color:var(--muted);}
.section{margin-bottom:16px;}
.ep{background:var(--bg2);border:1px solid var(--bd);border-radius:7px;padding:9px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.ep .meth{font-size:.58rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(16,185,129,.15);color:#6ee7b7;border:1px solid rgba(16,185,129,.3);white-space:nowrap;flex-shrink:0;}
.ep .pth{font-family:monospace;font-size:.8rem;flex:1;color:var(--txt);min-width:0;word-break:break-all;}
.ep .dsc{font-size:.7rem;color:var(--muted);}
.ep.highlight{border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.05);}
.ep.highlight .pth{color:#6ee7b7;font-weight:600;}
.note{border-left:3px solid #475569;padding:8px 12px;font-size:.78rem;color:var(--muted);margin:8px 0;background:var(--bg3);border-radius:0 5px 5px 0;}
.note strong{color:var(--txt);}
footer{text-align:center;padding:18px;font-size:.7rem;color:var(--muted);border-top:1px solid var(--bd);margin-top:28px;}
@media(max-width:600px){.ep .dsc{width:100%;}.container{padding:14px 10px;}}
</style>
</head>
<body>
<header>
  <div class="logo">6<span>stream</span></div>
  <div class="hd-nav"><a href="/">Home</a></div>
</header>
<div class="container">

<div class="hero">
  <h1>6stream API Documentation</h1>
  <p>Anime API. All endpoints return JSON. <br/>No API key needed to view this page — you'll need one to call the endpoints.</p>
  <a class="get-btn" href="${FB_LINK}" target="_blank">Contact Me to Get an API Key</a>
</div>

<h2>Endpoints</h2>

<div class="section">
<h3>Anime — Browse</h3>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/home</span><span class="dsc">Featured & recent</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/all</span><span class="dsc">Home + latest + popular</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/latest?page=1</span><span class="dsc">Latest updated</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/popular?page=1</span><span class="dsc">Most viewed</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/search?q=title</span><span class="dsc">Search by title</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/genres</span><span class="dsc">All genres</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/genre/:genreId?page=1</span><span class="dsc">By genre</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/type/:type?page=1</span><span class="dsc">tv/movie/ova/ona/special/music</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/status/:status?page=1</span><span class="dsc">currently-airing / finished-airing / not-yet-aired</span></div>
</div>

<div class="section">
<h3>Anime — Detail & Stream</h3>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/anime/:slug</span><span class="dsc">Info + numericId</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/anime/:slug/episodes</span><span class="dsc">Episode list</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/servers?key=serverKey</span><span class="dsc">Servers for episode</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/source/:linkId</span><span class="dsc">Embed URL</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/player?url=embedUrl</span><span class="dsc">m3u8 + subtitles</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/stream/:linkId</span><span class="dsc">embed + m3u8 + subtitles</span></div>
<div class="ep highlight"><span class="meth">GET</span><span class="pth">/api/play/:slug/:epNum?type=sub&server=0</span><span class="dsc">Full pipeline in one call</span></div>
</div>

<div class="section">
<h3>HLS Proxy & Utility</h3>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/hls?url=m3u8_url</span><span class="dsc">Proxy stream (no CORS)</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/hls-download?url=m3u8_url&name=title</span><span class="dsc">Download as MP4</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/proxy?url=page_url</span><span class="dsc">Embed with ad-blocker</span></div>
<div class="ep"><span class="meth">GET</span><span class="pth">/api/img-proxy?url=image_url</span><span class="dsc">Proxy protected images</span></div>
</div>

<h2>Streaming Flow</h2>

<div class="note"><strong>Quickest:</strong> Use <code>/api/play/:slug/:epNum</code> — one call gets everything.</div>

<pre>
<span class="cmt"># Step-by-step:</span>
1. GET /api/anime/one-piece        → numericId: 12
2. GET /api/anime/one-piece/episodes?id=12 → serverKey: "abc123"
3. GET /api/servers?key=abc123     → linkId: "xyz789"
4. GET /api/source/xyz789          → embedUrl
5. GET /api/player?url=embedUrl    → m3u8 + subtitles

<span class="cmt"># OR one call:</span>
GET /api/play/one-piece/1</pre>

<h2>Code Samples</h2>
<p style="font-size:.82rem;color:var(--muted);margin-bottom:8px;">Replace <code>YOUR_API_KEY</code> with the key you receive.</p>

<h3>cURL</h3>
<pre>
curl "${BASE}/api/home?apipass=YOUR_API_KEY"

curl "${BASE}/api/search?q=naruto&apipass=YOUR_API_KEY"

curl "${BASE}/api/play/one-piece/1?apipass=YOUR_API_KEY"</pre>

<h3>JavaScript</h3>
<pre>
const KEY = "YOUR_API_KEY";

fetch("<span class="url">${BASE}/api/home</span>", {
  headers: { "Authorization": \`Bearer \${KEY}\` }
});

fetch("<span class="url">${BASE}/api/play/one-piece/1</span>", {
  headers: { "Authorization": \`Bearer \${KEY}\` }
});</pre>

<h3>Python</h3>
<pre>
import requests
r = requests.get("<span class="url">${BASE}/api/home</span>",
  headers={"Authorization": "Bearer YOUR_API_KEY"})</pre>

<h3>React Native</h3>
<pre>
import Video from 'react-native-video';

async function play(slug, ep) {
  const r = await fetch(
    \`<span class="url">${BASE}/api/play/\${slug}/\${ep}</span>\`,
    { headers: { Authorization: "Bearer YOUR_API_KEY" } }
  );
  const d = await r.json();
  return \`<span class="url">${BASE}/api/hls?url=\${encodeURIComponent(d.sources[0].url)}</span>\`;
}</pre>

</div>
<footer><strong>6stream API</strong> &mdash; <a href="${FB_LINK}">Contact for API Key</a></footer>
</body>
</html>`);
});

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
    <p>Full anime scraper API. All routes return JSON. Built by <strong style="color:var(--txt)">Jhames Martin</strong> &mdash; source: <code>anisuge.se</code>.</p>
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
    ${ep('/api/img-proxy<span class="qs">?url=imageUrl</span>',"Image proxy for protected CDNs")}
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
    console.log(`\n6stream API  -> http://localhost:${PORT}/api\n`);
  });

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
