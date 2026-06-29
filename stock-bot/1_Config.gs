// ============================================================
// 1_Config.gs ─ 全域常數、LINE API 工具、快取、策略註冊表
// ============================================================

const CHANNEL_ACCESS_TOKEN =
  PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') ||
  "5E/pMy+QqwbHetAow9Ixkoqz99f6OzioURI9gtdlNbi0W7Myj+v9Zd0R7zfzc+vEWV8Ms7qjxuZfOv8SwB8q7vCMX4yLFmbWteavmjjtCI1zvx7TiIi8uLN+IjK6YDzXHYcC8El4V1FsF/bD8T9AowdB04t89/1O/w1cDnyilFU=";

function getChannelAccessToken() { return CHANNEL_ACCESS_TOKEN; }

// ─── LINE API 工具 ────────────────────────────────────────────

function replyTextMessage(replyToken, text) {
  return sendReply(replyToken, [{ type: "text", text }]);
}
function replyFlexMessage(replyToken, altText, flexContents) {
  return sendReply(replyToken, [{ type: "flex", altText, contents: flexContents }]);
}
function sendReply(replyToken, messages) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({ replyToken, messages }),
    muteHttpExceptions: true
  });
}
function pushFlexToLine(userId, flexContent, altText) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: "flex", altText: altText || "系統推播訊息", contents: flexContent }]
    }),
    muteHttpExceptions: true
  });
}
function sendLoadingAnimation(userId, seconds) {
  seconds = Math.min(Math.max(seconds || 5, 5), 60);
  UrlFetchApp.fetch("https://api.line.me/v2/bot/chat/loading/start", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
    muteHttpExceptions: true
  });
}

// ─── 共用工具 ─────────────────────────────────────────────────

function formatAmountUnit(val) {
  const n = Number(val);
  if (!n || isNaN(n)) return "0 元";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + " 億";
  if (n >= 1e4) return (n / 1e4).toFixed(2) + " 萬";
  return n.toLocaleString() + " 元";
}

function parseSheetTime(raw, fallback) {
  fallback = fallback || "10:00";
  if (!raw) return fallback;
  if (raw instanceof Date) return Utilities.formatDate(raw, "GMT+8", "HH:mm");
  const p = String(raw).trim().split(":");
  return p.length >= 2 ? p[0].padStart(2,"0") + ":" + p[1].padStart(2,"0") : fallback;
}

// ─── priceMap 分段快取 ────────────────────────────────────────

const PRICE_MAP_CACHE_PREFIX = "priceMap_chunk_";
const PRICE_MAP_META_KEY     = "priceMap_meta";
const PRICE_MAP_CACHE_TTL    = 300;
const PRICE_MAP_CHUNK_SIZE   = 200;

function getCachedPriceMap() {
  const cache = CacheService.getScriptCache();
  try {
    const meta = cache.get(PRICE_MAP_META_KEY);
    if (meta) {
      const { chunks } = JSON.parse(meta);
      let merged = {};
      for (let i = 0; i < chunks; i++) {
        const chunk = cache.get(PRICE_MAP_CACHE_PREFIX + i);
        if (!chunk) { merged = null; break; }
        Object.assign(merged, JSON.parse(chunk));
      }
      if (merged) return merged;
    }
  } catch (e) {}
  const priceMap = buildPriceMapFromDb();
  _writePriceMapCache(priceMap);
  return priceMap;
}

function _writePriceMapCache(priceMap) {
  const cache   = CacheService.getScriptCache();
  const entries = Object.entries(priceMap);
  const chunks  = Math.ceil(entries.length / PRICE_MAP_CHUNK_SIZE);
  const putObj  = {};
  for (let i = 0; i < chunks; i++) {
    putObj[PRICE_MAP_CACHE_PREFIX + i] =
      JSON.stringify(Object.fromEntries(entries.slice(i * PRICE_MAP_CHUNK_SIZE, (i+1) * PRICE_MAP_CHUNK_SIZE)));
  }
  putObj[PRICE_MAP_META_KEY] = JSON.stringify({ chunks, ts: Date.now() });
  try { cache.putAll(putObj, PRICE_MAP_CACHE_TTL); } catch (e) {}
}

function invalidatePriceMapCache() {
  const cache = CacheService.getScriptCache();
  try {
    const meta = cache.get(PRICE_MAP_META_KEY);
    if (meta) {
      const { chunks } = JSON.parse(meta);
      const keys = [PRICE_MAP_META_KEY];
      for (let i = 0; i < chunks; i++) keys.push(PRICE_MAP_CACHE_PREFIX + i);
      cache.removeAll(keys);
    }
  } catch (e) { cache.remove(PRICE_MAP_META_KEY); }
}

// ─── 策略註冊表 ───────────────────────────────────────────────

const STRATEGY_REGISTRY = {
  "TOP9_AMOUNT": {
    name:   "市場吸金排行",
    label:  "⭐ 收藏市場吸金 TOP 9",
    color:  "#1E3A8A",
    sortFn: (a, b) => b.amount - a.amount
  },
  "TOP9_GAINERS": {
    name:   "現股當沖強勢榜",
    label:  "⚡ 收藏當沖強勢 TOP 9",
    color:  "#EA580C",
    sortFn: (a, b) => b.changePct - a.changePct
  },
  "TOP9_LOSERS": {
    name:   "跌幅最深排行",
    label:  "📉 收藏跌幅最深 TOP 9",
    color:  "#6B7280",
    sortFn: (a, b) => a.changePct - b.changePct
  }
};

function getStrategyName(type) {
  return (STRATEGY_REGISTRY[type] || {}).name || "精選股票推薦";
}
