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
const PORT = process.env.PORT || 3000;
const ACCESS_LIST_URL = process.env.ACCESS_LIST_URL || Buffer.from(
  "aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2pybXBoMTMva2Fid2VuYmR2bndvYm53L3JlZnMvaGVhZHMvbWFpbi9hY2Nlc3MudHh0",
  "base64"
).toString("utf8");

const normalizeOrigin = (value = "") => {
  const raw = String(value).trim();
  if (!raw || raw.startsWith("#")) return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
};

const defaultAllowedOrigins = [
  normalizeOrigin("http://6stream.vercel.app/"),
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

app.use((req, res, next) => {
  if (Date.now() - accessListFetchedAt > 5 * 60 * 1000) {
    refreshAllowedOrigins();
  }
  const origin = normalizeOrigin(req.headers.origin);
  const refererOrigin = normalizeOrigin(req.headers.referer);
  const requestOrigin = origin || refererOrigin;
  const allowed = !requestOrigin || allowedOrigins.has(requestOrigin);

  if (req.path.startsWith("/api") && !requestOrigin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (requestOrigin && !allowed) {
    return res.status(403).json({
      error: "Forbidden",
    });
  }

  if (origin) {
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header("Vary", "Origin");
  }
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
  res.sendFile(require("path").join(__dirname, "test.html"));
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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
  const [home, latest, popular, genres] = await Promise.all([
    getHome().catch(() => null),
    getLatestUpdated(1).catch(() => []),
    getMostViewed(1).catch(() => []),
    getGenres().catch(() => []),
  ]);
  res.json({
    success: true,
    data: {
      featured: home?.featured || [],
      recent: home?.recent || [],
      latest,
      popular,
      genres,
    },
  });
}));

app.get("/api/home", wrap(async (req, res) => {
  const data = await getHome();
  res.json({ success: true, data });
}));

app.get("/api/latest", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await getLatestUpdated(page);
  res.json({ success: true, page, total: data.length, data });
}));

app.get("/api/popular", wrap(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await getMostViewed(page);
  res.json({ success: true, page, total: data.length, data });
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
  const data = await getServers(key);
  res.json({ success: true, total: data.length, data });
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
  const data = await getVideoSource(req.params.linkId);
  res.json({ success: true, data });
}));

// ── Referer map: CDN host → correct player origin ────────────────────────────
const CDN_REFERERS = [
  { match: ["cinewave", "lostproject"],         ref: "https://megaplay.buzz/" },
  { match: ["watching.onl", "fxpy"],            ref: "https://vidwish.live/"  },
  { match: ["cdn.hanime", "hanime.tv"],         ref: "https://hanime.tv/"     },
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

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", isM3U8req ? "no-cache" : "public, max-age=3600");

  // Return cached m3u8 if fresh
  if (isM3U8req && m3u8Cache.has(url)) {
    const { text, time } = m3u8Cache.get(url);
    if (Date.now() - time < M3U8_TTL) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.send(text);
    }
    m3u8Cache.delete(url);
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
      const proxyBase = `${req.protocol}://${req.get("host")}`;
      const rewritten = body.replace(/^(?!#)(\S.*)$/gm, (line) => {
        line = line.trim();
        if (!line) return line;
        const abs = line.startsWith("http") ? line : base + line;
        return `${proxyBase}/api/hls?url=${encodeURIComponent(abs)}`;
      });
      m3u8Cache.set(url, { text: rewritten, time: Date.now() });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
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
    timeout: 30000,
  });

  res.setHeader("Content-Type", "video/MP2T");
  if (r.headers["content-length"]) res.setHeader("Content-Length", r.headers["content-length"]);
  r.data.pipe(res);
}));

// GET /api/player?url=<embedUrl>  →  real m3u8 + subtitles from getSources API
app.get("/api/player", wrap(async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, message: "url param required" });
  const data = await getPlayerSources(url);
  res.json({ success: true, embedUrl: url, ...data });
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
  const font = "C\\:/Windows/Fonts/arialbd.ttf";
  const watermark = `drawtext=fontfile='${font}':text='6stream':x=w-tw-24:y=24:fontsize=max(28\\,h*0.055):fontcolor=white@0.62:shadowcolor=black@0.85:shadowx=3:shadowy=3`;
  const rawName = String(req.query.name || id)
    .replace(/<[^>]*>/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || id;
  const filename = `6Stream-jrmph-${rawName}.mp4`;

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
