const axios = require("axios");
const cheerio = require("cheerio");
const axiosRetry = require("axios-retry").default;

const BASE_URL = "https://anisuge.se";

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: BASE_URL + "/",
  },
  timeout: 15000,
});

axiosRetry(client, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const ajaxClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    Referer: BASE_URL + "/",
  },
  timeout: 15000,
});

axiosRetry(ajaxClient, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

// Parse anime cards from home/list pages
// Structure: .item > .inner > .item-top / .item-bottom
function parseCards($, container) {
  const items = [];
  $(container || "body")
    .find(".item")
    .each((_, el) => {
      const posterEl = $(el).find("a.poster");
      const href = posterEl.attr("href") || "";
      const slug = slugFromUrl(href);
      const poster =
        $(el).find("img").attr("data-src") ||
        $(el).find("img").attr("src") ||
        "";
      const nameEl = $(el).find(".item-bottom .name a");
      const title = nameEl.text().trim();
      const titleJP = nameEl.attr("data-jp") || null;
      const type = $(el).find(".item-status .type").text().trim() || null;
      const sub = $(el).find(".dub-sub-total .sub").text().trim() || null;
      const dub = $(el).find(".dub-sub-total .dub").text().trim() || null;
      const total = $(el).find(".dub-sub-total .total").text().trim() || null;
      const numericId = posterEl.attr("data-tip") || null;
      if (slug && title) {
        items.push({ slug, numericId, title, titleJP, poster, type, sub, dub, total });
      }
    });
  return items;
}

// Home page — recent/latest updated anime
async function getHome() {
  const res = await client.get("/home");
  const $ = cheerio.load(res.data);
  const items = parseCards($);

  // Slider/featured
  const featured = [];
  $(".swiper-slide .item, .slider .item").each((_, el) => {
    const a = $(el).find("a.poster, a").first();
    const href = a.attr("href") || "";
    const slug = slugFromUrl(href);
    const title = $(el).find(".name a, h2, h3").first().text().trim();
    const poster =
      $(el).find("img").attr("data-src") || $(el).find("img").attr("src") || "";
    if (slug && title) featured.push({ slug, title, poster });
  });

  return { featured, recent: items };
}

// Latest updated
async function getLatestUpdated(page = 1) {
  const res = await client.get(`/latest-updated?page=${page}`);
  const $ = cheerio.load(res.data);
  return parseCards($);
}

// Most viewed / popular
async function getMostViewed(page = 1) {
  const res = await client.get(`/most-viewed?page=${page}`);
  const $ = cheerio.load(res.data);
  return parseCards($);
}

// Search — uses AJAX endpoint (returns rich JSON with HTML)
async function searchAnime(query) {
  const res = await ajaxClient.get("/ajax/anime/search", {
    params: { keyword: query },
  });
  const html = res.data?.result?.html || res.data?.html || "";
  const $ = cheerio.load(html);
  const results = [];
  $("a.item").each((_, el) => {
    const href = $(el).attr("href") || "";
    const slug = slugFromUrl(href);
    const poster =
      $(el).find("img").attr("data-src") || $(el).find("img").attr("src") || "";
    const title = $(el).find(".name").text().trim();
    const titleJP = $(el).find(".name").attr("data-jp") || null;
    const rating = $(el).find(".rating").text().trim() || null;
    const dots = $(el).find(".dot").map((i, d) => $(d).text().trim()).get();
    // dots[0] = score (has star icon), dots[1] = type, dots[2] = date
    const score = dots[0] || null;
    const type = dots[1] || null;
    const aired = dots[2] || null;
    if (slug && title) results.push({ slug, title, titleJP, poster, rating, type, score, aired });
  });
  return results;
}

// Anime detail — fetches /watch/{slug} and parses info + gets numericId
async function getAnimeInfo(slug) {
  const res = await client.get(`/watch/${slug}`);
  const $ = cheerio.load(res.data);

  const numericId =
    $(".container.watch-wrap").attr("data-id") ||
    $("[data-id]").first().attr("data-id") ||
    null;

  const title = $("h1.title").first().text().trim();
  const titleJP =
    $("h1.title").first().attr("data-jp") ||
    $("p[style='font-size: 12px;']").first().text().trim() ||
    null;
  const poster =
    $("#media-info .poster img").attr("src") ||
    $("#media-info .poster img").attr("data-src") ||
    "";
  const banner =
    $(".media-bg").attr("style")?.match(/url\('([^']+)'\)/)?.[1] || null;
  const synopsis =
    $(".description .short div").first().text().trim() ||
    $(".description .full div").first().text().trim() ||
    "";

  const meta = {};
  $(".meta > div").each((_, el) => {
    const label = $(el).find("div:first-child").text().replace(":", "").trim().toLowerCase();
    // collect direct text and link text, skip commas
    const value = $(el)
      .find("span")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (label && value) meta[label] = value;
  });

  const genres = [];
  $(".meta a[href*='/genre/']").each((_, el) => {
    genres.push($(el).text().trim());
  });

  const status = $(".meta a[href*='/status/']").first().text().trim() || null;

  return {
    slug,
    numericId,
    title,
    titleJP,
    poster,
    banner,
    synopsis,
    genres,
    status,
    meta,
  };
}

// Episode list — uses AJAX endpoint with numericId
async function getEpisodes(numericId) {
  const res = await ajaxClient.get(`/ajax/episode/list/${numericId}`);
  const html = res.data?.result || res.data?.html || res.data || "";
  const $ = cheerio.load(html);

  const episodes = [];
  $(".range a").each((_, el) => {
    const epId = $(el).attr("data-id");
    const epNum = parseInt($(el).attr("data-slug") || $(el).text().trim()) || null;
    const title = $(el).attr("data-num") || `Episode ${epNum}`;
    const mal = $(el).attr("data-mal") || null;
    const serverKey = $(el).attr("data-ids") || null; // base64 server IDs blob
    const sub = $(el).attr("data-sub") === "1";
    const dub = $(el).attr("data-dub") === "1";
    if (epId) {
      episodes.push({ epId, epNum, title, mal, sub, dub, serverKey });
    }
  });

  return episodes.sort((a, b) => (a.epNum || 0) - (b.epNum || 0));
}

// Server list for an episode — pass the data-ids (serverKey) from an episode
async function getServers(serverKey) {
  const res = await ajaxClient.get("/ajax/server/list", {
    params: { servers: serverKey },
  });
  const html = res.data?.result || res.data?.html || res.data || "";
  const $ = cheerio.load(html);

  const servers = [];
  $(".server").each((_, el) => {
    const linkId = $(el).attr("data-link-id");
    const svId = $(el).attr("data-sv-id");
    const epId = $(el).attr("data-ep-id");
    const name = $(el).find("span").text().trim();
    const type = $(el).closest("[data-type]").attr("data-type") || "sub";
    if (linkId) servers.push({ name, svId, linkId, epId, type });
  });

  return servers;
}

// Video source URL — pass the data-link-id from a server
async function getVideoSource(linkId) {
  const res = await ajaxClient.get("/ajax/server", { params: { get: linkId } });
  const result = res.data?.result;
  if (!result) throw new Error("No video source found");
  return {
    url: result.url,
    skipData: result.skip_data || null,
  };
}

// Genre list — parse from nav
async function getGenres() {
  const res = await client.get("/home");
  const $ = cheerio.load(res.data);
  const genres = [];
  $("a[href*='/genre/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const id = href.replace(/.*\/genre\//, "").replace(/\/$/, "");
    const name = $(el).text().trim();
    if (id && name && !genres.find((g) => g.id === id)) {
      genres.push({ id, name });
    }
  });
  return genres;
}

// Browse by genre
async function getGenreAnime(genreId, page = 1) {
  const res = await client.get(`/genre/${genreId}?page=${page}`);
  const $ = cheerio.load(res.data);
  return parseCards($);
}

// Browse by type (tv, movie, ova, ona, special, music)
async function getTypeAnime(type, page = 1) {
  const res = await client.get(`/type/${type}?page=${page}`);
  const $ = cheerio.load(res.data);
  return parseCards($);
}

// Browse by status (currently-airing, finished-airing, not-yet-aired)
async function getStatusAnime(status, page = 1) {
  const res = await client.get(`/status/${status}?page=${page}`);
  const $ = cheerio.load(res.data);
  return parseCards($);
}

function slugFromUrl(href) {
  if (!href) return null;
  // https://anisuge.se/watch/slug-here  OR  /watch/slug-here
  const match = href.match(/\/watch\/([^\/\?]+)/);
  return match ? match[1] : null;
}

// Short-lived cache for getSources (valid ~5 min — CDN URLs expire)
const _srcCache = new Map();
const SRC_TTL = 5 * 60 * 1000;

// Get real m3u8 + subtitles from an embed URL (megaplay/vidwish)
async function getPlayerSources(embedUrl) {
  if (_srcCache.has(embedUrl)) {
    const { data, time } = _srcCache.get(embedUrl);
    if (Date.now() - time < SRC_TTL) return data;
    _srcCache.delete(embedUrl);
  }
  // 1. Fetch the player HTML to get data-id
  const res = await client.get(embedUrl, {
    headers: { Referer: "https://anisuge.se/" },
  });
  const $ = cheerio.load(res.data);

  const dataId =
    $("[data-id]").first().attr("data-id") ||
    res.data.match(/data-id=[\"']([^\"']+)[\"']/i)?.[1];

  if (!dataId) throw new Error("Could not extract data-id from player page");

  // 2. Parse base URL of the player (megaplay.buzz or vidwish.live etc.)
  const urlObj = new URL(embedUrl);
  const playerBase = `${urlObj.protocol}//${urlObj.hostname}`;

  // 3. Call getSources API (use player's own domain as referer)
  const srcRes = await client.get(
    `${playerBase}/stream/getSources?id=${dataId}&id=${dataId}`,
    {
      headers: {
        Referer:             `${playerBase}/`,
        Origin:              playerBase,
        "X-Requested-With": "XMLHttpRequest",
      },
    }
  );

  const data = srcRes.data;

  const sources = [];
  if (data.sources?.file) {
    const url = data.sources.file;
    sources.push({
      type: url.includes(".m3u8") ? "hls" : url.includes(".mp4") ? "mp4" : "stream",
      url,
    });
  }

  const subtitles = (data.tracks || [])
    .filter((t) => t.file)
    .map((t) => ({
      label: t.label || "English",
      kind:  t.kind  || "captions",
      url:   t.file,
      type:  t.file.includes(".vtt") ? "vtt" : t.file.includes(".srt") ? "srt" : "subtitle",
      default: t.default || false,
    }));

  const result = {
    sources,
    subtitles,
    intro:  data.intro  || null,
    outro:  data.outro  || null,
    server: data.server || null,
  };
  _srcCache.set(embedUrl, { data: result, time: Date.now() });
  return result;
}

module.exports = {
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
};
