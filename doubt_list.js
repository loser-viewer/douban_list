WidgetMetadata = {
  id: "douban.custom.list.random",
  title: "豆瓣自定义片单",
  description: "支持豆列 / 官方榜单 / App dispatch，并支持随机排序",
  author: "ChatGPT",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  detailCacheDuration: 60,
  modules: [
    {
      title: "豆瓣自定义片单",
      description: "支持格式: 桌面/移动端豆列、官方榜单、App dispatch",
      requiresWebView: false,
      functionName: "loadEnhancedDoubanList",
      cacheDuration: 3600,
      params: [
        {
          name: "url",
          title: "🔗 片单地址",
          type: "input",
          description: "支持格式: 桌面/移动端豆列、官方榜单、App dispatch",
          placeholders: [
            { title: "一周电影口碑榜", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/movie_weekly_best/&dt_dapp=1" },
            { title: "华语口碑剧集榜", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/tv_chinese_best_weekly/&dt_dapp=1" },
            { title: "全球口碑剧集榜", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/tv_global_best_weekly/&dt_dapp=1" },
            { title: "国内热播综艺", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/show_domestic/&dt_dapp=1" },
            { title: "国外热播综艺", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/show_foreign/&dt_dapp=1" },
            { title: "当地影院热映", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/movie_showing/&dt_dapp=1" },
            { title: "热门动画", value: "https://www.douban.com/doubanapp/dispatch?uri=/subject_collection/tv_animation/&dt_dapp=1" }
          ]
        },
        {
          name: "sort_by",
          title: "🔢 排序方式",
          type: "enumeration",
          value: "default",
          enumOptions: [
            { title: "默认顺序", value: "default" },
            { title: "随机排序", value: "random" }
          ]
        },
        { name: "page", title: "页码", type: "page" }
      ]
    }
  ]
};

// ===================== 基础工具函数 =====================

function normalizeText(text) {
  return String(text || "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/：/g, ":")
    .replace(/[·•・]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(text) {
  const match = String(text || "").match(/(19|20)\d{2}/);
  return match ? match[0] : "";
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseDoubanAppDispatchUrl(url) {
  const cleanedUrl = String(url || "").trim();
  const queryIndex = cleanedUrl.indexOf("?");

  if (queryIndex === -1) return cleanedUrl;

  const queryString = cleanedUrl.slice(queryIndex + 1);
  const pairs = queryString.split("&");
  const params = {};

  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    params[decodeURIComponent(key || "")] = decodeURIComponent(value || "");
  }

  const uri = params.uri;
  if (!uri) return cleanedUrl;

  const path = uri.startsWith("/") ? uri.slice(1) : uri;

  if (path.includes("subject_collection/")) {
    return `https://m.douban.com/${path}`;
  }

  if (path.includes("doulist/")) {
    return `https://www.douban.com/${path}`;
  }

  return cleanedUrl;
}

function shuffleArray(array) {
  const arr = Array.isArray(array) ? [...array] : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function sortEnhancedDoubanItems(items, sortBy = "default") {
  if (!Array.isArray(items)) return [];
  if (sortBy === "random") return shuffleArray(items);
  return items;
}

function calculatePagination(params = {}) {
  const page = Math.max(parseInt(params.page || 1, 10), 1);
  const limit = Math.max(parseInt(params.limit || 20, 10), 1);
  const start = (page - 1) * limit;
  return { page, limit, start };
}

function getOriginalTitleFromDoubanItem(item) {
  if (!item) return "";
  return normalizeText(
    item.title ||
    item.name ||
    item.subject?.title ||
    ""
  );
}

function getOriginalYearFromDoubanItem(item) {
  if (!item) return "";
  return (
    item.year ||
    extractYear(item.card_subtitle) ||
    extractYear(item.info) ||
    extractYear(item.description) ||
    ""
  );
}

function cleanSearchTitle(title) {
  return normalizeText(title)
    .replace(/\b(第[一二三四五六七八九十\d]+季)\b/g, "")
    .replace(/\bseason\s*\d+\b/ig, "")
    .replace(/\bpart\s*\d+\b/ig, "")
    .trim();
}

function stringSimilarity(a, b) {
  const x = normalizeText(a).toLowerCase();
  const y = normalizeText(b).toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;

  const xSet = new Set(x.split(""));
  const ySet = new Set(y.split(""));
  let common = 0;
  for (const ch of xSet) {
    if (ySet.has(ch)) common++;
  }
  return common / Math.max(xSet.size, ySet.size, 1);
}

// ===================== TMDB 类型与流派 =====================

let __tmdbGenreCache = null;

async function fetchTmdbGenres() {
  if (__tmdbGenreCache) return __tmdbGenreCache;

  const [movieGenres, tvGenres] = await Promise.all([
    Widget.tmdb.get("/genre/movie/list"),
    Widget.tmdb.get("/genre/tv/list")
  ]);

  __tmdbGenreCache = {
    movie: movieGenres.genres || [],
    tv: tvGenres.genres || []
  };

  return __tmdbGenreCache;
}

function getTmdbGenreTitles(genreIds = [], mediaType = "movie") {
  if (!__tmdbGenreCache) return "";
  const genres = mediaType === "tv" ? __tmdbGenreCache.tv : __tmdbGenreCache.movie;
  const names = genres
    .filter(g => genreIds.includes(g.id))
    .map(g => g.name)
    .slice(0, 3);
  return names.join(" / ");
}

function generateGenreTitleFromTmdb(tmdbItem, doubanItem) {
  const mediaType = tmdbItem.media_type || (tmdbItem.title ? "movie" : "tv");
  const genreIds = tmdbItem.genre_ids || tmdbItem.genres?.map(g => g.id) || [];
  const fromTmdb = getTmdbGenreTitles(genreIds, mediaType);
  if (fromTmdb) return fromTmdb;

  const subtitle = doubanItem?.card_subtitle || doubanItem?.info || doubanItem?.description || "";
  return normalizeText(subtitle).split("/").map(s => s.trim()).filter(Boolean).slice(0, 3).join(" / ");
}

// ===================== TMDB 搜索与匹配 =====================

async function searchTmdbMulti(query, year = "") {
  const q = cleanSearchTitle(query);
  if (!q) return [];

  const params = { query: q, include_adult: false };
  const data = await Widget.tmdb.get("/search/multi", { params });

  let results = Array.isArray(data.results) ? data.results : [];
  results = results.filter(item => {
    const mediaType = item.media_type;
    return (mediaType === "movie" || mediaType === "tv") &&
      item.id &&
      item.poster_path &&
      (item.title || item.name);
  });

  if (year) {
    const filtered = results.filter(item => {
      const itemYear = extractYear(item.release_date || item.first_air_date || "");
      return itemYear === String(year);
    });
    if (filtered.length > 0) return filtered;
  }

  return results;
}

function selectBestTmdbMatch(tmdbResults, title, year = "") {
  if (!Array.isArray(tmdbResults) || tmdbResults.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const item of tmdbResults) {
    const itemTitle = item.title || item.name || "";
    const itemYear = extractYear(item.release_date || item.first_air_date || "");
    let score = 0;

    score += stringSimilarity(title, itemTitle) * 100;
    score += safeNumber(item.popularity) * 0.02;
    score += safeNumber(item.vote_average) * 2;

    if (year && itemYear === String(year)) {
      score += 30;
    } else if (year && itemYear) {
      const diff = Math.abs(parseInt(itemYear, 10) - parseInt(year, 10));
      if (diff === 1) score += 8;
      if (diff >= 2) score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

function buildTmdbCard(match, doubanItem) {
  const mediaType = match.media_type || (match.title ? "movie" : "tv");
  return {
    id: String(match.id),
    type: "tmdb",
    title: match.title || match.name,
    description: match.overview || "",
    releaseDate: match.release_date || match.first_air_date || "",
    backdropPath: match.backdrop_path || "",
    posterPath: match.poster_path || "",
    rating: safeNumber(match.vote_average),
    mediaType,
    genreTitle: generateGenreTitleFromTmdb(match, doubanItem),
    originalDoubanTitle: getOriginalTitleFromDoubanItem(doubanItem),
    originalDoubanYear: getOriginalYearFromDoubanItem(doubanItem),
    originalDoubanId: doubanItem?.id ? String(doubanItem.id) : ""
  };
}

async function fetchImdbItemsForDouban(scItems = []) {
  await fetchTmdbGenres();

  const promises = scItems.map(async (scItem) => {
    const title = getOriginalTitleFromDoubanItem(scItem);
    const year = getOriginalYearFromDoubanItem(scItem);

    if (!title) return null;

    try {
      const tmdbResults = await searchTmdbMulti(title, year);
      if (!tmdbResults.length) return null;

      const bestMatch = selectBestTmdbMatch(tmdbResults, title, year);
      if (!bestMatch) return null;

      return buildTmdbCard(bestMatch, scItem);
    } catch (e) {
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

// ===================== 豆瓣入口 =====================

async function loadEnhancedDoubanList(params = {}) {
  const url = String(params.url || "").trim();
  if (!url) return [];

  if (url.includes("douban.com/doulist/")) {
    return loadEnhancedDefaultList(params);
  }

  if (url.includes("m.douban.com/doulist/")) {
    const desktopUrl = url.replace("m.douban.com", "www.douban.com");
    return loadEnhancedDefaultList({ ...params, url: desktopUrl });
  }

  if (url.includes("subject_collection/")) {
    return loadEnhancedSubjectCollection(params);
  }

  if (url.includes("douban.com/doubanapp/dispatch")) {
    const parsedUrl = parseDoubanAppDispatchUrl(url);
    return loadEnhancedDoubanList({ ...params, url: parsedUrl });
  }

  return [];
}

// ===================== 桌面/移动豆列 =====================

async function loadEnhancedDefaultList(params = {}) {
  const url = String(params.url || "");
  const listId = url.match(/doulist\/(\d+)/)?.[1];
  if (!listId) return [];

  const page = Math.max(parseInt(params.page || 1, 10), 1);
  const count = 25;
  const start = (page - 1) * count;
  const pageUrl = `https://www.douban.com/doulist/${listId}/?start=${start}&sort=seq&playable=0&sub_type=`;

  const response = await Widget.http.get(pageUrl, {
    headers: {
      Referer: "https://movie.douban.com/explore",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    }
  });

  const docId = Widget.dom.parse(response.data);
  const itemNodes = Widget.dom.select(docId, ".doulist-item");

  const doubanItems = [];

  for (const node of itemNodes) {
    const titleAnchor = Widget.dom.select(node, ".title a")?.[0];
    const abstractNode = Widget.dom.select(node, ".abstract")?.[0];
    const ratingNode = Widget.dom.select(node, ".rating_nums")?.[0];

    const href = titleAnchor ? await Widget.dom.attr(titleAnchor, "href") : "";
    const rawTitle = titleAnchor ? await Widget.dom.text(titleAnchor) : "";
    const info = abstractNode ? await Widget.dom.text(abstractNode) : "";
    const ratingText = ratingNode ? await Widget.dom.text(ratingNode) : "";

    const title = normalizeText(rawTitle);
    if (!title) continue;

    const year = extractYear(info || title);
    const doubanId = href.match(/subject\/(\d+)/)?.[1] || "";

    doubanItems.push({
      id: doubanId,
      title,
      year,
      info: normalizeText(info),
      rating: safeNumber(ratingText)
    });
  }

  const items = await fetchImdbItemsForDouban(doubanItems);
  return sortEnhancedDoubanItems(items, params.sort_by || "default");
}

// ===================== subject_collection / 官方榜单 =====================

async function loadEnhancedItemsFromApi(params = {}) {
  const url = String(params.url || "");
  const listId = url.match(/subject_collection\/(\w+)/)?.[1] || "";

  const response = await Widget.http.get(url, {
    headers: {
      Referer: `https://m.douban.com/subject_collection/${listId}/`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    }
  });

  const scItems = response.data?.subject_collection_items || [];
  return await fetchImdbItemsForDouban(scItems);
}

async function loadEnhancedSubjectCollection(params = {}) {
  const listId = String(params.url || "").match(/subject_collection\/(\w+)/)?.[1];
  if (!listId) return [];

  const page = Math.max(parseInt(params.page || 1, 10), 1);
  const count = 20;
  const start = (page - 1) * count;

  let pageUrl = `https://m.douban.com/rexxar/api/v2/subject_collection/${listId}/items?start=${start}&count=${count}&updated_at&items_only=1&type_tag&for_mobile=1`;

  if (params.type) {
    pageUrl += `&type=${params.type}`;
  }

  const items = await loadEnhancedItemsFromApi({ ...params, url: pageUrl });
  return sortEnhancedDoubanItems(items, params.sort_by || "default");
}
