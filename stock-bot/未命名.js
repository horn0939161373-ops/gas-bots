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

// ============================================================
// 2_Main.gs ─ LINE Webhook 入口
// ============================================================

// ─── 交易日判斷（六日不推播）────────────────────────────────
function _isTradingDay() {
  const day = new Date().getDay(); // 0=日, 6=六
  return day !== 0 && day !== 6;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(3000); } catch (f) {
    return ContentService.createTextOutput("OK");
  }
  try {
    if (!e || !e.postData) return ContentService.createTextOutput("OK");
    const event = JSON.parse(e.postData.contents).events[0];
    if (!event) return ContentService.createTextOutput("OK");

    const replyToken = event.replyToken;
    const userId     = event.source && event.source.userId;

    if (event.type === "follow") {
      sendLoadingAnimation(userId, 5);
      replyFlexMessage(replyToken, "每日股票推薦推播", FlexMessage.getMenuCarousel());
      return ContentService.createTextOutput("OK");
    }
    if (event.type === "message" && event.message.type === "text") {
      handleTextMessage(replyToken, userId, event.message.text.trim());
      return ContentService.createTextOutput("OK");
    }
    if (event.type === "postback") {
      handlePostback(replyToken, userId, event.postback);
    }
  } catch (err) {
    Logger.log("doPost 錯誤: " + err.message);
    try {
      const rt = JSON.parse(e.postData.contents).events[0].replyToken;
      replyTextMessage(rt, "⚠️ 系統發生錯誤，請稍後再試。");
    } catch (e2) {}
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput("OK");
}

// ─── 快取預熱（每 4 分鐘，六日也跑維持快取）─────────────────
function warmUpAllCaches() {
  try {
    const priceMap = buildPriceMapFromDb();
    _writePriceMapCache(priceMap);
    Logger.log("🔥 priceMap 快取預熱完成: " + Object.keys(priceMap).length + " 筆");
  } catch (e) { Logger.log("priceMap 預熱失敗: " + e.message); }

  try {
    refreshTaiexCache();
    Logger.log("🔥 大盤快取預熱完成");
  } catch (e) { Logger.log("大盤預熱失敗: " + e.message); }
}

// ─── 文字訊息 ─────────────────────────────────────────────────

function handleTextMessage(replyToken, userId, msg) {

  // ✅ 投資組合建立流程（State Machine）優先判斷
  const ps = getPortfolioState(userId);
  if (ps && /^\d+(\.\d+)?$/.test(msg)) {
    handlePortfolioInput(replyToken, userId, ps, Number(msg));
    return;
  }

  // 手寫到價數字
  const state = getUserState(userId);
  if (state && /^\d+(\.\d+)?$/.test(msg)) {
    _addAlertNoLock(userId, state.code, state.name, state.dir, Number(msg));
    clearUserState(userId);
    replyTextMessage(replyToken,
      `✅ 設定成功！\n當 ${state.name} (${state.code}) ${state.dir === "UP" ? "漲破" : "跌穿"} $${msg} 時，將發送通知！\n點擊「我的收藏」確認。`);
    return;
  }

  switch (msg) {
    case "選單":
      sendLoadingAnimation(userId, 5);
      replyFlexMessage(replyToken, "每日股票推薦推播", FlexMessage.getMenuCarousel());
      break;

    case "我的收藏":
      sendLoadingAnimation(userId, 5);
      handleMyCollections(replyToken, userId);
      break;

    case "我的投資組合":
      sendLoadingAnimation(userId, 5);
      handlePortfolioQuery(replyToken, userId);
      break;

    case "說明":
      replyTextMessage(replyToken,
        "💡 【股市秘書快捷指南】\n\n" +
        "1.【選單】每日推薦推播\n" +
        "2.【手動查詢】輸入代碼 (如 2330) 或中文名\n" +
        "3.【我的收藏】管理全部收藏\n" +
        "4.【我的投資組合】查看持倉損益");
      break;

    default: {
      sendLoadingAnimation(userId, 5);
      const info = searchStockFromDbFast(msg);
      if (info) replyFlexMessage(replyToken, `${info.name} 行情查詢`, FlexMessage.getConfirmCard(info));
      else replyTextMessage(replyToken, `抱歉，系統未檢索到與「${msg}」相符的標的，請輸入正確的代碼或中文名。`);
    }
  }
}

function searchStockFromDbFast(query) {
  const q = String(query).trim().toUpperCase();
  if (/^\d+[A-Z]?$/.test(q) || q === "TAIEX") {
    const pm = getCachedPriceMap();
    const d  = pm[q];
    if (d) {
      return { code: q, gCode: "", price: d.price, name: d.name,
        change: d.change, changepct: d.changepct,
        volume: 0, amount: Number(d.amount) || 0 };
    }
  }
  return searchStockFromDb(query);
}

// ─── 我的收藏 ─────────────────────────────────────────────────

function handleMyCollections(replyToken, userId) {
  try {
    const collections    = getAggregatedUserCollections(userId);
    const userStrategies = getUserStrategiesFromDb(userId);

    if ((!collections || collections.length === 0) && userStrategies.length === 0) {
      replyTextMessage(replyToken, "您目前清單內還沒有收藏任何標的喔！");
      return;
    }

    const priceMap = getCachedPriceMap();
    _injectTaiexIntoPriceMap(priceMap);

    let flexContent;
    if (collections && collections.length > 0) {
      flexContent = FlexMessage.getUnifiedDashboardCarousel(collections, priceMap, userId);
    } else {
      flexContent = { type: "carousel", contents: [] };
    }

    userStrategies.forEach(s => {
      flexContent.contents.push(buildStrategyManageBubble(s.strategyType, s.pushTime));
    });

    const res = replyFlexMessage(replyToken, "我的收藏清單", flexContent);
    if (res && res.getResponseCode() !== 200) {
      const list = (collections || []).map(s => `• ${s.name || s.code}`).join("\n");
      replyTextMessage(replyToken,
        `⚠️ 卡片發送失敗。\n\n您的收藏：\n${list}\n\nLINE 錯誤：\n${res.getContentText().substring(0, 200)}`);
    }
  } catch (err) {
    Logger.log("❌ handleMyCollections: " + err.stack);
    replyTextMessage(replyToken, `❌ 讀取收藏時發生錯誤：${err.message}`);
  }
}

// ─── Postback ─────────────────────────────────────────────────

function handlePostback(replyToken, userId, postback) {
  const p = {};
  (postback.data || "").split("&").forEach(kv => {
    const [k, v] = kv.split("=");
    p[k] = decodeURIComponent(v || "");
  });
  const action = p.action;

  if (action === "view_strategy") {
    sendLoadingAnimation(userId, 5);
    const stocks = getStrategyStocks(p.strategyType);
    if (stocks && stocks.length > 0) {
      replyFlexMessage(replyToken, `📊 最新 ${getStrategyName(p.strategyType)} 排行榜`,
        buildStrategyFlexCarousel(p.strategyType, stocks, _nowHHMM()));
    } else {
      replyTextMessage(replyToken, `⚠️ 目前無法讀取 ${getStrategyName(p.strategyType)} 的即時數據。`);
    }
    return;
  }

  if (action === "strategy_time_select") {
    if (postback.params && postback.params.time) {
      upsertStrategyPush(userId, p.strategyType, postback.params.time);
      replyTextMessage(replyToken,
        `⏰ 推播時間變更成功！\n【${getStrategyName(p.strategyType)}】已調整為每日 ${postback.params.time} 發送。`);
    }
    return;
  }

  if (action === "view_taiex") {
    const td = getTaiexDataCached();
    if (td) replyFlexMessage(replyToken, "📊 台灣加權指數", buildTaiexCard(td));
    else replyTextMessage(replyToken, "⚠️ 目前無法取得大盤資料，請稍後再試。");
    return;
  }

  if (action === "subscribe_strategy") {
    const name = getStrategyName(p.strategyType);
    if (getUserStrategiesFromDb(userId).some(s => s.strategyType === p.strategyType)) {
      replyTextMessage(replyToken, `💡 您已收藏【${name}】，可從「我的收藏」管理。`);
    } else {
      upsertStrategyPush(userId, p.strategyType, "10:00");
      replyTextMessage(replyToken, `⭐️ 成功收藏【${name}】！預設每日 10:00 推播，可從「我的收藏」更改。`);
    }
    return;
  }

  if (action === "delete_strategy") {
    deleteStrategyPush(userId, p.strategyType);
    replyTextMessage(replyToken, `❌ 已關閉【${getStrategyName(p.strategyType)}】的每日策略推播。`);
    return;
  }

  if (action === "confirm_save") {
    if (getUserPushes(userId).some(q => q.code === p.code && q.hasPush)) {
      replyTextMessage(replyToken, `💡 【${p.name}】早就在您的推播名單中囉！`);
    } else {
      _upsertPushNoLock(userId, p.code, p.name, "10:00", true);
      replyTextMessage(replyToken, `⭐️ 已將【${p.name}】加入每日推播清單！預設 10:00，從「我的收藏」可調整。`);
    }
    return;
  }

  if (action === "delete_save") {
    replyTextMessage(replyToken,
      _deletePushNoLock(userId, p.code)
        ? `❌ 已關閉【${p.name}】的每日推播。\n(到價通知若有設定，仍會獨立觸發)`
        : "您本來就沒有開啟這支股票的每日推播喔！");
    return;
  }

  if (action === "change_time_select") {
    if (postback.params && postback.params.time) {
      _upsertPushNoLock(userId, p.code, p.name, postback.params.time, true);
      replyTextMessage(replyToken,
        `⏰ 時間變更成功！\n【${p.name || p.code}】的推播時間已調整為 ${postback.params.time}。`);
    }
    return;
  }

  if (action === "set_alert_init") {
    let price = p.price || "0";
    const pm  = getCachedPriceMap();
    const cu  = p.code.toUpperCase();
    if (pm[cu]) price = pm[cu].price;
    replyFlexMessage(replyToken, `設定 ${p.name} 到價通知`,
      FlexMessage.getAlertSetupCard(p.code, p.name, price));
    return;
  }

  if (action === "set_alert_quick") {
    _addAlertNoLock(userId, p.code, p.name, p.dir, p.target);
    replyTextMessage(replyToken,
      `✅ 快捷設定成功！\n當 ${p.name} ${p.dir === "UP" ? "漲破" : "跌穿"} $${p.target} 時將推播通知！`);
    return;
  }

  if (action === "set_alert_state") {
    setUserState(userId, p.code, p.name, p.dir);
    replyTextMessage(replyToken,
      `✏️ 請直接在對話框輸入您想設定的【${p.dir === "UP" ? "漲破" : "跌穿"}】數值（例如：${p.dir === "UP" ? "850" : "720"}）`);
    return;
  }

  if (action === "delete_alert") {
    _deleteAlertNoLock(userId, p.code, p.target);
    replyTextMessage(replyToken, `🗑 已移除 ${p.code} 目標價 $${p.target} 的到價監控。`);
    return;
  }

  if (action === "alert_cancel_ack") {
    replyTextMessage(replyToken, `👌 已確認取消！系統不再對【${p.name}】發送此價格的通知。`);
    return;
  }

  // noop：已開啟技術警示的灰色按鈕
  if (action === "noop") {
    replyTextMessage(replyToken, decodeURIComponent(p.msg || "此功能目前無法操作。"));
    return;
  }

  // 投資組合 postback
  if (handlePortfolioPostback(replyToken, userId, p)) return;

  // 技術警示 postback
  if (handleTechAlertPostback(replyToken, userId, p)) return;
}

// ============================================================
// 3_StockDatabase.gs ─ 台股資料庫同步與查詢
// ============================================================

/** 從 TWSE / TPEX 批次同步收盤資料到 StockDatabase */
function syncTaiwanStockDatabase() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockDatabase");
  if (!sheet) return;

  const isPostMarket = new Date().getHours() >= 14;
  const existingData = sheet.getDataRange().getValues();

  // 代碼（大寫）→ 行號 快查表
  const stockMap = {};
  for (let i = 1; i < existingData.length; i++) {
    const code = String(existingData[i][0]).replace(/'/g,"").trim().toUpperCase();
    if (code) stockMap[code] = i + 1;
  }

  // 並行抓取兩交易所（正則支援正2反1，如 00631L、00632R）
  const rawList = [];
  [
    { url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",       type: "TPE" },
    { url: "https://openapi.tpex.org.tw/v1/tpex/exchangeReport/STOCK_DAY_ALL", type: "TWO" }
  ].forEach(src => {
    try {
      const res = UrlFetchApp.fetch(src.url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return;
      JSON.parse(res.getContentText()).forEach(s => {
        const code = String(s.Code || s.code || "").trim().toUpperCase();
        const name = String(s.Name || s.name || "").trim();
        if (/^\d{4,6}[A-Z]?$/.test(code)) {
          rawList.push({ code, name, type: src.type,
            price: s.ClosingPrice, change: s.Change,
            vol: s.TradeVolume || s.Volume || 0,
            amt: s.TradeValue  || s.Amount || 0 });
        }
      });
    } catch (e) { Logger.log(`抓取 ${src.type} 失敗: ${e.message}`); }
  });

  // 分為「更新既有行」與「新增行」
  const updateMap = {}, appendRows = [];
  let lastRow = existingData.length;

  rawList.forEach(s => {
    const rowIdx = stockMap[s.code] || ++lastRow;
    const isNew  = !stockMap[s.code];
    const amtVal = isPostMarket ? Number(s.amt) : `=IFERROR(C${rowIdx}*G${rowIdx},0)`;
    const row = [
      "'" + s.code, `${s.type}:${s.code}`,
      `=IFERROR(GOOGLEFINANCE(B${rowIdx},"price"),${Number(s.price)||0})`,
      s.name,
      `=IFERROR(GOOGLEFINANCE(B${rowIdx},"change"),${Number(s.change)||0})`,
      `=IFERROR(ROUND((E${rowIdx}/(C${rowIdx}-E${rowIdx}))*100,2),0)`,
      `=IFERROR(GOOGLEFINANCE(B${rowIdx},"volume"),${Number(s.vol)})`,
      amtVal, Number(s.amt), Number(s.price) || 0
    ];
    if (isNew) appendRows.push(row);
    else       updateMap[rowIdx] = row;
  });

  // 連續行批次寫入
  const sorted = Object.keys(updateMap).map(Number).sort((a,b) => a-b);
  let bStart = null, bData = [];
  const flush = () => {
    if (!bData.length) return;
    sheet.getRange(bStart, 1, bData.length, bData[0].length).setValues(bData);
    bStart = null; bData = [];
  };
  sorted.forEach(idx => {
    if (bStart === null) { bStart = idx; bData = [updateMap[idx]]; }
    else if (idx === bStart + bData.length) bData.push(updateMap[idx]);
    else { flush(); bStart = idx; bData = [updateMap[idx]]; }
  });
  flush();

  if (appendRows.length)
    sheet.getRange(sheet.getLastRow()+1, 1, appendRows.length, appendRows[0].length).setValues(appendRows);

  invalidatePriceMapCache();
  Logger.log(`✅ StockDatabase 同步完成，更新 ${sorted.length} 筆，新增 ${appendRows.length} 筆`);
}

/**
 * 依代碼或中文名搜尋個股
 * 代碼統一大寫比對，支援正2反1（00631L 等）
 */
function searchStockFromDb(query) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockDatabase");
  if (!sheet) return null;

  const data       = sheet.getDataRange().getValues();
  const queryUpper = String(query).trim().toUpperCase();
  const queryLower = String(query).trim().toLowerCase();
  const isCode     = /^\d+[a-zA-Z]?$/.test(String(query).trim());

  for (let i = 1; i < data.length; i++) {
    const code = String(data[i][0]).replace(/'/g,"").trim().toUpperCase();
    const name = isCode ? "" : String(data[i][3]).trim().toLowerCase();
    if (code !== queryUpper && name !== queryLower) continue;

    let price = data[i][2], change = data[i][4],
        pct   = data[i][5], vol    = data[i][6], amt = data[i][7];
    if (String(price).startsWith("="))  price  = data[i][9] || "---";
    if (String(change).startsWith("=")) change = "0";
    if (String(pct).startsWith("="))    pct    = "0";
    if (String(vol).startsWith("="))    vol    = "0";
    if (String(amt).startsWith("="))    amt    = Number(price) * Number(vol) || 0;

    return { code, gCode: data[i][1], price,
      name: data[i][3], change, changepct: pct,
      volume: vol, amount: Number(amt) || 0 };
  }
  return null;
}

/** 讀 StockDatabase 建立 priceMap（供 getCachedPriceMap 呼叫） */
function buildPriceMapFromDb() {
  const priceMap = {};
  const sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockDatabase");
  if (!sheet) return priceMap;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const code = String(data[i][0]).replace(/'/g,"").trim().toUpperCase();
    if (!code) continue;
    let p = data[i][2], v = data[i][6], amt = data[i][7];
    if (String(p).startsWith("="))   p   = data[i][9] || 0;
    if (String(v).startsWith("="))   v   = 0;
    if (String(amt).startsWith("=")) amt = Number(p) * Number(v) || 0;
    priceMap[code] = {
      price: p, change: data[i][4], changepct: data[i][5],
      amount: amt, name: String(data[i][3])
    };
  }
  return priceMap;
}

// ============================================================
// 4_FlexMessage.gs ─ Flex 訊息組裝工廠
// ============================================================

const FlexMessage = {

  // ─── 主選單 Carousel ──────────────────────────────────────
  getMenuCarousel: function () {
    const priceMap = getCachedPriceMap();
    const stocks = [], etfs = [];

    Object.entries(priceMap).forEach(([code, d]) => {
      if (!code || code === "TAIEX") return;
      const item = { code, price: d.price, name: d.name,
        change: d.change, changepct: d.changepct,
        amount: Number(d.amount) || 0 };
      if (code.startsWith("00") || code.length === 6) etfs.push(item);
      else stocks.push(item);
    });
    stocks.sort((a, b) => b.amount - a.amount);
    etfs.sort((a, b) => b.amount - a.amount);
    const recommendList = [...stocks.slice(0, 3), ...etfs.slice(0, 1)];

    const bubbles = [];

    const strategyButtons = Object.entries(STRATEGY_REGISTRY).map(([type, s]) => ({
      type: "button", style: "primary", color: s.color, height: "sm",
      action: { type: "postback", label: s.label,
        data: `action=subscribe_strategy&strategyType=${type}` }
    }));

    bubbles.push({
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", contents: [
        { type: "text", text: "📊 每日特選策略推播", weight: "bold", size: "md", color: "#ffffff" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: "🔥 今日推薦觀察榜", weight: "bold", size: "sm", color: "#1E3A8A" },
        { type: "text", text: "向右滑動瀏覽今日「成交金額最高」的強勢個股與 ETF。\n\n點選下方按鈕，一鍵訂閱各策略每日定時推播！",
          wrap: true, size: "xs", color: "#475569" },
        { type: "separator", margin: "md" },
        { type: "text", text: "🔍 手動查詢", weight: "bold", size: "sm", color: "#0F172A" },
        { type: "text", text: "直接輸入代碼 (如 2330) 或中文名，即可快速調閱行情圖卡。",
          wrap: true, size: "xs", color: "#475569" }
      ]},
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: strategyButtons }
    });

    recommendList.forEach((stock, idx) => {
      const isUp  = Number(stock.change) >= 0;
      const arrow = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
      const tag   = stock.code.startsWith("00") ? "🏆 今日最吸金 ETF 推薦" : `🔥 熱門吸金推薦 No.${idx + 1}`;
      bubbles.push(this._buildStockMenuBubble(stock, tag, arrow, color));
    });

    try {
      const td = getTaiexDataFromSheet();
      if (td) bubbles.push(this._buildTaiexMenuBubble(td));
    } catch (e) { Logger.log("選單大盤失敗: " + e.message); }

    return { type: "carousel", contents: bubbles };
  },

  _buildStockMenuBubble: function (stock, tag, arrow, color) {
    const en = encodeURIComponent(stock.name);
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
        { type: "text", text: tag, size: "xs", color: "#F59E0B", weight: "bold" },
        { type: "text", text: stock.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
        { type: "text", text: "代碼: " + stock.code, size: "xs", color: "#94A3B8" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        this._row("當前現價", "$" + stock.price),
        this._row("今日漲跌", `${arrow} ${stock.change} (${stock.changepct}%)`, color),
        this._row("成交金額", formatAmountUnit(stock.amount), "#1E40AF")
      ]},
      footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "primary", color: "#1E3A8A", height: "sm", flex: 1,
            action: { type: "postback", label: "⭐ 收藏推播",
              data: `action=confirm_save&code=${stock.code}&name=${en}` }},
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "🔔 到價通知",
              data: `action=set_alert_init&code=${stock.code}&name=${en}&price=${stock.price}` }}
        ]},
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "secondary", color: "#065F46", height: "sm", flex: 1,
            action: { type: "postback", label: "💼 加入持倉",
              data: `action=portfolio_add_init&code=${stock.code}&name=${en}` }},
          { type: "button", style: "secondary", color: "#7C3AED", height: "sm", flex: 1,
            action: { type: "postback", label: "📊 技術警示",
              data: `action=add_tech_alert&code=${stock.code}&name=${en}&types=MA_CROSS,VOLUME_SURGE` }}
        ]}
      ]}
    };
  },

  _buildTaiexMenuBubble: function (td) {
    const raw   = Number(td.change) || 0;
    const isUp  = raw >= 0;
    const arrow = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
    const en    = encodeURIComponent(td.name);
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
        { type: "text", text: "📊 台灣股市大盤動態", size: "xs", color: "#F59E0B", weight: "bold" },
        { type: "text", text: td.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
        { type: "text", text: "代碼: " + td.code, size: "xs", color: "#94A3B8" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        this._row("當前指數", td.price),
        this._row("今日漲跌", `${arrow} ${Math.abs(raw).toFixed(2)} (${Math.abs(Number(td.changePct)||0).toFixed(2)}%)`, color)
      ]},
      footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
        { type: "button", style: "primary", color: "#1E3A8A", height: "sm",
          action: { type: "postback", label: "⭐ 收藏推播",
            data: `action=confirm_save&code=${td.code}&name=${en}` }},
        { type: "button", style: "secondary", height: "sm",
          action: { type: "postback", label: "🔔 到價通知",
            data: `action=set_alert_init&code=${td.code}&name=${en}&price=${td.price}` }}
      ]}
    };
  },

  // ─── 個股行情確認卡 ───────────────────────────────────────
  getConfirmCard: function (info) {
    const isUp  = Number(info.change) >= 0;
    const arrow = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
    const en    = encodeURIComponent(info.name);
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E293B", contents: [
        { type: "text", text: "📈 個股行情查詢結果", size: "xs", color: "#38BDF8", weight: "bold" },
        { type: "text", text: info.name, weight: "bold", size: "lg", color: "#ffffff", margin: "xs" },
        { type: "text", text: "代碼: " + info.code, size: "xs", color: "#94A3B8" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        this._row("💰 當前現價", "$" + info.price),
        this._row("📊 漲跌幅度", `${arrow} ${info.change} (${info.changepct}%)`, color),
        this._row("💎 成交金額", formatAmountUnit(info.amount), "#1E40AF")
      ]},
      footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "primary", color: "#1E40AF", height: "sm", flex: 1,
            action: { type: "postback", label: "⭐ 收藏推播",
              data: `action=confirm_save&code=${info.code}&name=${en}` }},
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "🔔 到價通知",
              data: `action=set_alert_init&code=${info.code}&name=${en}&price=${info.price}` }}
        ]},
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "secondary", color: "#065F46", height: "sm", flex: 1,
            action: { type: "postback", label: "💼 加入持倉",
              data: `action=portfolio_add_init&code=${info.code}&name=${en}` }},
          { type: "button", style: "secondary", color: "#7C3AED", height: "sm", flex: 1,
            action: { type: "postback", label: "📊 技術警示",
              data: `action=add_tech_alert&code=${info.code}&name=${en}&types=MA_CROSS,VOLUME_SURGE` }}
        ]}
      ]}
    };
  },

  // ─── 到價通知設定卡 ───────────────────────────────────────
  getAlertSetupCard: function (code, name, priceStr) {
    const p   = Number(priceStr) || 0;
    const en  = encodeURIComponent(name);
    const up3 = (p * 1.03).toFixed(1);
    const dn3 = (p * 0.97).toFixed(1);
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
        { type: "text", text: "🔔 設定到價通知", weight: "bold", color: "#38BDF8", size: "sm" },
        { type: "text", text: `${name} (${code})`, weight: "bold", size: "lg", color: "#ffffff", margin: "xs" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: "目前現價：$" + p, weight: "bold", size: "md", color: "#1E293B" },
        { type: "text", text: "請選擇快捷幅度，或點選手寫按鈕自行輸入數字：",
          wrap: true, size: "xs", color: "#475569" }
      ]},
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "button", style: "primary", color: "#EF4444", height: "sm",
          action: { type: "postback", label: `📈 漲破3% $${up3}`,
            data: `action=set_alert_quick&code=${code}&name=${en}&dir=UP&target=${up3}` }},
        { type: "button", style: "primary", color: "#10B981", height: "sm",
          action: { type: "postback", label: `📉 跌穿3% $${dn3}`,
            data: `action=set_alert_quick&code=${code}&name=${en}&dir=DOWN&target=${dn3}` }},
        { type: "separator", margin: "md" },
        { type: "box", layout: "horizontal", spacing: "sm", contents: [
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "✏️ 手寫漲破",
              data: `action=set_alert_state&code=${code}&name=${en}&dir=UP` }},
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "✏️ 手寫跌穿",
              data: `action=set_alert_state&code=${code}&name=${en}&dir=DOWN` }}
        ]}
      ]}
    };
  },

  // ─── 我的收藏 Carousel ────────────────────────────────────
  getUnifiedDashboardCarousel: function (collections, priceMap, userId) {
    if (!collections || collections.length === 0) {
      return { type: "carousel", contents: [{
        type: "bubble", size: "mega",
        body: { type: "box", layout: "vertical", paddingAll: "xl", contents: [
          { type: "text", text: "💡 收藏清單空空如也", weight: "bold", color: "#1E3A8A", size: "md" },
          { type: "text", text: "尚未收藏任何個股推播或到價通知。\n請點擊「選單」或輸入代碼查詢並加入！",
            wrap: true, size: "sm", color: "#475569", margin: "md" }
        ]}
      }]};
    }

    const techAlertCodes = _getUserTechAlertCodes(userId);

    const bubbles = collections.slice(0, 9).map(item => {
      const live      = priceMap[item.code.toUpperCase()] || { price: "---", change: 0, changepct: 0, amount: 0 };
      const isUp      = Number(live.change) >= 0;
      const arrow     = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
      const en        = encodeURIComponent(item.name || "");
      const t         = parseSheetTime(item.hasPush ? item.pushTime : null, "10:00");
      const hasTech   = !!techAlertCodes[item.code.toUpperCase()];
      const techTypes = hasTech ? (techAlertCodes[item.code.toUpperCase()].alertTypes || []) : [];
      const typeLabel = { MA_CROSS: "均線突破", VOLUME_SURGE: "量能異常", OPENING_SURGE: "開盤異常" };

      const techNodes = hasTech && techTypes.length > 0
        ? [{ type: "box", layout: "horizontal", margin: "xs", contents: [
            { type: "text",
              text: techTypes.map(t => "✓ " + (typeLabel[t] || t)).join("　"),
              size: "xs", color: "#7C3AED", weight: "bold", flex: 4, wrap: true },
            { type: "button", style: "link", color: "#EF4444", height: "sm", flex: 2,
              action: { type: "postback", label: "[關閉]",
                data: `action=delete_tech_alert&code=${item.code}&name=${en}` }}
          ]}]
        : [{ type: "text", text: "尚未開啟技術警示", size: "xs", color: "#94A3B8", style: "italic" }];

      const alertNodes = item.alertPrices && item.alertPrices.length > 0
        ? item.alertPrices.map(a => {
            const up = a.dir === "UP" || a.dir === "漲破";
            return { type: "box", layout: "horizontal", margin: "xs", alignItems: "center", contents: [
              { type: "text", text: `🎯 ${up ? "漲破 📈" : "跌穿 📉"} $${a.target}`,
                size: "xs", color: up ? "#EF4444" : "#10B981", weight: "bold", flex: 4 },
              { type: "button", style: "link", color: "#EF4444", height: "sm", flex: 2,
                action: { type: "postback", label: "[刪除]",
                  data: `action=delete_alert&code=${item.code}&target=${a.target}` }}
            ]};
          })
        : [{ type: "text", text: "暫無設定到價通知", size: "xs", color: "#94A3B8", style: "italic" }];

      return {
        type: "bubble", size: "mega",
        header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", contents: [
          { type: "text", text: String(item.name || "未知名稱"), weight: "bold", size: "md", color: "#ffffff" },
          { type: "text", text: `代碼: ${item.code}\n推播時間: ${item.hasPush ? t : "未開啟定時推播"}`,
            size: "xs", color: "#93C5FD", margin: "xs", wrap: true }
        ]},
        body: { type: "box", layout: "vertical", spacing: "xs", contents: [
          this._row("即時現價", "$" + live.price),
          this._row("今日漲跌", `${arrow} ${live.change} (${live.changepct}%)`, color),
          this._row("成交金額", formatAmountUnit(live.amount), "#1E40AF"),
          { type: "separator", margin: "sm" },
          { type: "text", text: "📊 技術警示監控：", size: "xs", weight: "bold", margin: "sm", color: "#1E293B" },
          ...techNodes,
          { type: "separator", margin: "sm" },
          { type: "text", text: "🔔 已排定到價通知：", size: "xs", weight: "bold", margin: "sm", color: "#1E293B" },
          ...alertNodes
        ]},
        footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
          { type: "button", height: "sm", style: item.hasPush ? "secondary" : "primary",
            action: { type: "datetimepicker",
              label: item.hasPush ? "⏰ 更改推播時間" : "⏰ 啟動推播",
              data: `action=change_time_select&code=${item.code}&name=${en}`,
              mode: "time", initial: t }},
          { type: "box", layout: "horizontal", spacing: "xs", contents: [
            { type: "button", style: "secondary", color: "#F59E0B", height: "sm", flex: 1,
              action: { type: "postback", label: "🔔 到價通知",
                data: `action=set_alert_init&code=${item.code}&name=${en}` }},
            { type: "button", style: "secondary", color: hasTech ? "#94A3B8" : "#7C3AED", height: "sm", flex: 1,
              action: { type: "postback",
                label: hasTech ? "📊 監控中" : "📊 技術警示",
                data: hasTech
                  ? `action=noop&msg=已開啟監控，如需關閉請點卡片內%5B關閉%5D`
                  : `action=add_tech_alert&code=${item.code}&name=${en}&types=MA_CROSS,VOLUME_SURGE` }}
          ]},
          { type: "box", layout: "horizontal", spacing: "xs", contents: [
            { type: "button", style: "secondary", color: "#065F46", height: "sm", flex: 1,
              action: { type: "postback", label: "💼 加入持倉",
                data: `action=portfolio_add_init&code=${item.code}&name=${en}` }},
            { type: "button", style: "link", color: "#EF4444", height: "sm", flex: 1,
              action: { type: "postback", label: "❌ 取消推播",
                data: `action=delete_save&code=${item.code}&name=${en}` }}
          ]}
        ]}
      };
    });

    return { type: "carousel", contents: bubbles };
  },

  // ─── 共用方法 ─────────────────────────────────────────────
  _row: function (label, value, valueColor) {
    const v = { type: "text", text: String(value), weight: "bold", size: "xs", align: "end" };
    if (valueColor) v.color = valueColor;
    return { type: "box", layout: "horizontal",
      contents: [{ type: "text", text: label, color: "#475569", size: "xs" }, v] };
  }
};

// ─── 工具：取得用戶已開啟技術警示的代碼 Map ──────────────────
function _getUserTechAlertCodes(userId) {
  const map  = {};
  const list = getUserTechAlerts(userId);
  list.forEach(r => { map[r.code.toUpperCase()] = { alertTypes: r.alertTypes }; });
  return map;
}

// ─── 策略管理卡 ───────────────────────────────────────────────
function buildStrategyManageBubble(strategyType, pushTime) {
  const name = getStrategyName(strategyType);
  const t    = parseSheetTime(pushTime, "10:00");
  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#1E293B", contents: [
      { type: "text", text: "📊 策略推播訂閱項目", size: "xs", color: "#38BDF8", weight: "bold" },
      { type: "text", text: name, weight: "bold", size: "lg", color: "#ffffff", margin: "xs" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "md", contents: [
      { type: "box", layout: "horizontal", contents: [
        { type: "text", text: "⏰ 每日推播時間", color: "#475569", size: "sm" },
        { type: "text", text: t, weight: "bold", align: "end", size: "sm", color: "#0F172A" }
      ]},
      { type: "text", text: "系統將於上方時間自動抓取最新排行並發送。",
        wrap: true, size: "xs", color: "#64748B", margin: "sm" }
    ]},
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "button", style: "primary", color: "#0F172A", height: "sm",
        action: { type: "postback", label: "🔍 查看最新排行",
          data: `action=view_strategy&strategyType=${strategyType}` }},
      { type: "button", style: "secondary", color: "#1E3A8A", height: "sm",
        action: { type: "datetimepicker", label: "⏰ 修改推播時間",
          data: `action=strategy_time_select&strategyType=${strategyType}`,
          mode: "time", initial: t }},
      { type: "button", style: "link", color: "#EF4444", height: "sm",
        action: { type: "postback", label: "❌ 取消此策略收藏",
          data: `action=delete_strategy&strategyType=${strategyType}` }}
    ]}
  };
}

// ─── 策略排行榜 Carousel ──────────────────────────────────────
function buildStrategyFlexCarousel(strategyType, stocks, timeString) {
  const name    = getStrategyName(strategyType);
  const bubbles = stocks.map((s, idx) => {
    const isUp  = Number(s.change) >= 0;
    const arrow = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
    const en    = encodeURIComponent(s.name);
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
        { type: "text", text: `📊 ${name} No.${idx + 1}`, size: "xs", color: "#F59E0B", weight: "bold" },
        { type: "text", text: s.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
        { type: "text", text: `代碼: ${s.code}　更新: ${timeString}`, size: "xs", color: "#94A3B8" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        FlexMessage._row("當前現價", "$" + s.price),
        FlexMessage._row("今日漲跌", `${arrow} ${s.change} (${s.changePct}%)`, color),
        FlexMessage._row("成交金額", formatAmountUnit(s.amount), "#1E40AF")
      ]},
      footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "primary", color: "#1E3A8A", height: "sm", flex: 1,
            action: { type: "postback", label: "⭐ 收藏推播",
              data: `action=confirm_save&code=${s.code}&name=${en}` }},
          { type: "button", style: "secondary", height: "sm", flex: 1,
            action: { type: "postback", label: "🔔 到價通知",
              data: `action=set_alert_init&code=${s.code}&name=${en}` }}
        ]},
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "secondary", color: "#065F46", height: "sm", flex: 1,
            action: { type: "postback", label: "💼 加入持倉",
              data: `action=portfolio_add_init&code=${s.code}&name=${en}` }},
          { type: "button", style: "secondary", color: "#7C3AED", height: "sm", flex: 1,
            action: { type: "postback", label: "📊 技術警示",
              data: `action=add_tech_alert&code=${s.code}&name=${en}&types=MA_CROSS,VOLUME_SURGE` }}
        ]}
      ]}
    };
  });
  return { type: "carousel", contents: bubbles };
}

// ─── 大盤詳細卡 ───────────────────────────────────────────────
function buildTaiexCard(td) {
  const raw   = Number(td.change) || 0;
  const isUp  = raw >= 0;
  const arrow = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
  const en    = encodeURIComponent(td.name);
  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
      { type: "text", text: "📊 台灣加權指數（大盤）", size: "xs", color: "#F59E0B", weight: "bold" },
      { type: "text", text: td.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
      { type: "text", text: `代碼: ${td.code}　更新: ${td.time}`, size: "xs", color: "#94A3B8" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      FlexMessage._row("當前指數", td.price),
      FlexMessage._row("今日漲跌", `${arrow} ${Math.abs(raw).toFixed(2)} (${Math.abs(Number(td.changePct)||0).toFixed(2)}%)`, color)
    ]},
    footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
      { type: "button", style: "primary", color: "#1E3A8A", height: "sm",
        action: { type: "postback", label: "⭐ 收藏推播",
          data: `action=confirm_save&code=${td.code}&name=${en}` }},
      { type: "button", style: "secondary", height: "sm",
        action: { type: "postback", label: "🔔 到價通知",
          data: `action=set_alert_init&code=${td.code}&name=${en}&price=${td.price}` }}
    ]}
  };
}

// ============================================================
// 5_PushService.gs ─ 定時個股推播
// ============================================================

function triggerDailyStockPush() {
  if (!_isTradingDay()) return;
  const t = _nowHHMM();
  Logger.log("=== 定時推播檢查：" + t);
  executePushLogic(t, false);
}

function testForcePush() {
  Logger.log("=== 🚀 強制推播測試 ===");
  executePushLogic(null, true);
}

function executePushLogic(targetTime, isForceMode) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPushConfig");
  if (!sheet) return;

  const priceMap = getCachedPriceMap();
  _injectTaiexIntoPriceMap(priceMap);

  const data      = sheet.getDataRange().getValues();
  const userTasks = {};
  let   count     = 0;

  for (let i = 1; i < data.length; i++) {
    const userId   = String(data[i][0]).trim();
    const code     = String(data[i][1]).replace(/'/g,"").trim().toUpperCase();
    const name     = String(data[i][2]);
    const pushTime = parseSheetTime(data[i][3], "10:00");
    const hasPush  = data[i][4] === true || String(data[i][4]).toUpperCase() === "TRUE";

    if (!hasPush) continue;
    if (!isForceMode && pushTime !== targetTime) continue;

    const live = priceMap[code] || { price: "---", change: 0, changepct: 0, amount: 0, name };
    if (!userTasks[userId]) userTasks[userId] = [];
    userTasks[userId].push({
      code, name: live.name || name,
      price: live.price, change: live.change,
      changepct: live.changepct, amount: live.amount
    });
    count++;
  }

  Logger.log(`📦 個股推播 ${count} 筆`);
  if (!count) return;

  for (const uid in userTasks) {
    const bubbles = userTasks[uid].slice(0, 10).map(_buildPushBubble);
    const res = pushFlexToLine(uid, { type: "carousel", contents: bubbles }, "⏰ 您的每日股票定時推播");
    Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 個股推播 → ${uid}`);
  }
}

function _injectTaiexIntoPriceMap(priceMap) {
  try {
    const td = getTaiexDataFromSheet();
    if (!td) return;
    priceMap["TAIEX"] = {
      price:     parseFloat(String(td.price).replace(/,/g,"")) || 0,
      change:    String(td.change),
      changepct: String(td.changePct),
      amount:    0,
      name:      td.name || "加權指數 (大盤)"
    };
  } catch (e) {
    Logger.log("❌ 注入大盤失敗: " + e.message);
  }
}

function _buildPushBubble(stock) {
  const isUp    = Number(stock.change) >= 0;
  const arrow   = isUp ? "▲" : "▼", color = isUp ? "#EF4444" : "#10B981";
  const isTaiex = String(stock.code).toUpperCase() === "TAIEX";

  const body = [
    FlexMessage._row("當前現價", isTaiex ? String(stock.price) : "$" + String(stock.price)),
    FlexMessage._row("今日漲跌", `${arrow} ${stock.change} (${stock.changepct}%)`, color)
  ];
  if (!isTaiex) body.push(FlexMessage._row("成交金額", formatAmountUnit(stock.amount), "#1E40AF"));

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical",
      backgroundColor: isTaiex ? "#0F172A" : "#1E3A8A",
      contents: [
        { type: "text", text: isTaiex ? "📊 每日大盤推播" : "⏰ 每日定時推播",
          size: "xs", color: isTaiex ? "#F59E0B" : "#93C5FD", weight: "bold" },
        { type: "text", text: String(stock.name), weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
        { type: "text", text: "代碼: " + stock.code, size: "xs", color: isTaiex ? "#94A3B8" : "#93C5FD" }
      ]
    },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: body }
  };
}

// ============================================================
// 6_AlertService.gs ─ 到價通知監控與 CRUD
// ============================================================

function triggerPriceAlerts() {
  if (!_isTradingDay()) return;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try {
    const ss         = SpreadsheetApp.getActiveSpreadsheet();
    const alertSheet = ss.getSheetByName("UserAlertConfig");
    if (!alertSheet) return;
    const alertData = alertSheet.getDataRange().getValues();
    if (alertData.length <= 1) return;

    const priceMap = getCachedPriceMap();
    const toSend = {}, toDelete = [];

    for (let i = 1; i < alertData.length; i++) {
      const userId = String(alertData[i][0]).trim();
      const code   = String(alertData[i][1]).replace(/'/g,"").trim().toUpperCase();
      const name   = String(alertData[i][2]);
      const dir    = String(alertData[i][3]).trim().toUpperCase();
      const target = Number(alertData[i][4]);

      const entry = priceMap[code];
      const cur   = entry ? Number(entry.price) : 0;

      if (!cur || isNaN(cur) || cur <= 0) continue;
      if (!target || target <= 0) continue;

      const hit = (dir === "UP" && cur >= target) || (dir === "DOWN" && cur <= target);
      if (hit) {
        if (!toSend[userId]) toSend[userId] = [];
        toSend[userId].push({ code, name, dir, targetPrice: target, currentPrice: cur });
        toDelete.push(i + 1);
      }
    }

    if (!toDelete.length) return;

    let pushOk = true;
    for (const uid in toSend) {
      const bubbles = toSend[uid].slice(0, 10).map(_buildAlertBubble);
      const res = pushFlexToLine(uid, { type: "carousel", contents: bubbles }, "🚨 您有新的到價通知觸發");
      if (res.getResponseCode() !== 200) {
        Logger.log(`❌ 到價推播失敗 ${uid}: ${res.getContentText()}`);
        pushOk = false;
      } else {
        Logger.log(`✅ 到價推播 → ${uid}`);
      }
    }

    if (pushOk) {
      toDelete.sort((a, b) => b - a).forEach(r => alertSheet.deleteRow(r));
      Logger.log(`🗑 已刪除 ${toDelete.length} 筆已觸發條件`);
    } else {
      Logger.log("⚠️ 部分推播失敗，條件保留等待下次重試");
    }

  } finally {
    lock.releaseLock();
  }
}

function _buildAlertBubble(alert) {
  const isUp = alert.dir === "UP";
  const hc   = isUp ? "#EF4444" : "#10B981";
  const en   = encodeURIComponent(alert.name);
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: hc,
      contents: [{ type: "text", text: "🚨 到價通知觸發", color: "#ffffff", weight: "bold" }] },
    body: { type: "box", layout: "vertical", spacing: "md", contents: [
      { type: "text", text: `${alert.name} (${alert.code})`, weight: "bold", size: "xl" },
      { type: "text", text: `已 ${isUp ? "📈 漲破" : "📉 跌穿"} 目標價 $${alert.targetPrice}！`, wrap: true },
      { type: "text", text: `當前現價：$${alert.currentPrice}`, weight: "bold", color: hc },
      { type: "text", text: "(此監控已暫停，請選擇後續動作)", size: "xxs", color: "#94A3B8", wrap: true, margin: "md" }
    ]},
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "button", style: "primary", color: "#3B82F6",
        action: { type: "postback", label: "繼續監控原條件",
          data: `action=set_alert_quick&code=${alert.code}&name=${en}&dir=${alert.dir}&target=${alert.targetPrice}` }},
      { type: "button", style: "secondary",
        action: { type: "postback", label: "更改條件",
          data: `action=set_alert_init&code=${alert.code}&name=${en}` }},
      { type: "button", style: "link", color: "#EF4444",
        action: { type: "postback", label: "取消",
          data: `action=alert_cancel_ack&name=${en}` }}
    ]}
  };
}

function _addAlertNoLock(userId, code, name, dir, targetPrice) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let   sheet = ss.getSheetByName("UserAlertConfig");
    if (!sheet) {
      sheet = ss.insertSheet("UserAlertConfig");
      sheet.appendRow(["userId","code","name","dir","targetPrice","createdAt"]);
    }
    sheet.appendRow([String(userId).trim(), "'"+String(code).replace(/'/g,"").trim().toUpperCase(),
      String(name).trim(), String(dir).toUpperCase(), Number(targetPrice), new Date()]);
    return true;
  } catch (e) { Logger.log("新增到價通知失敗: "+e); return false; }
}

function _deleteAlertNoLock(userId, code, targetPrice) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserAlertConfig");
    if (!sheet) return false;
    const data = sheet.getDataRange().getValues();
    const uid  = String(userId).trim();
    const c    = String(code).replace(/'/g,"").trim().toUpperCase();
    for (let i = data.length-1; i > 0; i--) {
      if (String(data[i][0]).trim() === uid &&
          String(data[i][1]).replace(/'/g,"").trim().toUpperCase() === c &&
          Number(data[i][4]) === Number(targetPrice)) {
        sheet.deleteRow(i+1); return true;
      }
    }
    return false;
  } catch (e) { return false; }
}

function addAlertDb(userId, code, name, dir, targetPrice) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try   { return _addAlertNoLock(userId, code, name, dir, targetPrice); }
  finally { lock.releaseLock(); }
}
function deleteAlertDb(userId, code, targetPrice) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try   { return _deleteAlertNoLock(userId, code, targetPrice); }
  finally { lock.releaseLock(); }
}

function getUserAlerts(userId) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserAlertConfig");
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const uid  = String(userId).trim();
    return data.slice(1).filter(r => String(r[0]).trim() === uid).map(r => ({
      userId: String(r[0]),
      code:   String(r[1]).replace(/'/g,"").trim().toUpperCase(),
      name:   String(r[2]),
      dir:    String(r[3]).trim().toUpperCase(),
      target: Number(r[4])
    }));
  } catch (e) { return []; }
}

// ============================================================
// 7_UserCore.gs ─ 使用者個股推播 CRUD + 收藏聚合
// ============================================================

function ensurePushSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("UserPushConfig");
  if (!sheet) {
    sheet = ss.insertSheet("UserPushConfig");
    sheet.appendRow(["userId","code","name","pushTime","hasPush","updatedAt"]);
  }
  return sheet;
}

function getUserPushes(userId) {
  const sheet = ensurePushSheet();
  const data  = sheet.getDataRange().getValues();
  const uid   = String(userId).trim();
  return data.slice(1).filter(r => String(r[0]).trim() === uid).map(r => ({
    userId:   String(r[0]),
    code:     String(r[1]).replace(/'/g,"").trim().toUpperCase(),
    name:     String(r[2]),
    pushTime: parseSheetTime(r[3], "10:00"),
    hasPush:  r[4] === true || String(r[4]).toUpperCase() === "TRUE"
  }));
}

function _upsertPushNoLock(userId, code, name, pushTime, hasPush) {
  const sheet     = ensurePushSheet();
  const data      = sheet.getDataRange().getValues();
  const uid       = String(userId).trim();
  const cleanCode = String(code).replace(/'/g,"").trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== uid) continue;
    if (String(data[i][1]).replace(/'/g,"").trim().toUpperCase() !== cleanCode) continue;
    if (name) sheet.getRange(i+1,3).setValue(String(name));
    sheet.getRange(i+1,4).setValue(String(pushTime));
    sheet.getRange(i+1,5).setValue(hasPush);
    sheet.getRange(i+1,6).setValue(new Date());
    return true;
  }
  sheet.appendRow([uid, "'"+cleanCode, String(name), String(pushTime), hasPush, new Date()]);
  return true;
}

function _deletePushNoLock(userId, code) {
  const sheet     = ensurePushSheet();
  const data      = sheet.getDataRange().getValues();
  const uid       = String(userId).trim();
  const cleanCode = String(code).replace(/'/g,"").trim().toUpperCase();
  for (let i = data.length-1; i >= 1; i--) {
    if (String(data[i][0]).trim() !== uid) continue;
    if (String(data[i][1]).replace(/'/g,"").trim().toUpperCase() !== cleanCode) continue;
    sheet.deleteRow(i+1); return true;
  }
  return false;
}

function upsertPush(userId, code, name, pushTime, hasPush) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try   { return _upsertPushNoLock(userId, code, name, pushTime, hasPush); }
  finally { lock.releaseLock(); }
}
function deletePush(userId, code) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try   { return _deletePushNoLock(userId, code); }
  finally { lock.releaseLock(); }
}

function getAggregatedUserCollections(userId) {
  const map = {};
  getUserPushes(userId).forEach(p => {
    map[p.code] = { ...p, alertPrices: [] };
  });
  getUserAlerts(userId).forEach(a => {
    if (!map[a.code]) map[a.code] = {
      userId: a.userId, code: a.code, name: a.name,
      pushTime: "10:00", hasPush: false, alertPrices: []
    };
    map[a.code].alertPrices.push({ dir: a.dir, target: a.target });
  });
  return Object.values(map);
}

function setUserState(userId, code, name, dir) {
  CacheService.getScriptCache().put("state_"+String(userId).trim(),
    JSON.stringify({ code, name, dir }), 300);
}
function getUserState(userId) {
  const v = CacheService.getScriptCache().get("state_"+String(userId).trim());
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function clearUserState(userId) {
  CacheService.getScriptCache().remove("state_"+String(userId).trim());
}

// ============================================================
// 8_StrategyService.gs ─ 策略排行推播（TOP9）
// ============================================================

function checkAndPushStrategies() {
  if (!_isTradingDay()) return;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    Logger.log("⚠️ 系統忙碌，策略推播延後至下一分鐘");
    return;
  }
  try {
    const t        = _nowHHMM();
    const pushList = getStrategyPushListByTime(t);
    if (!pushList.length) return;

    pushList.forEach(task => {
      try {
        const stocks = getStrategyStocks(task.strategyType);
        if (stocks && stocks.length > 0) {
          pushFlexToLine(task.userId,
            buildStrategyFlexCarousel(task.strategyType, stocks, t),
            "📊 每日策略排行榜推播");
          Logger.log(`✅ 策略推播 [${task.strategyType}] → ${task.userId}`);
        }
      } catch (err) {
        Logger.log(`❌ 策略推播 ${task.userId} 失敗: ${err.message}`);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function getStrategyPushListByTime(targetTime) {
  const sheet = _getStrategySheet();
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const userId       = String(data[i][0]).trim();
    const strategyType = String(data[i][1]).trim();
    const pushTime     = parseSheetTime(data[i][2], "");
    if (userId && strategyType && pushTime === targetTime)
      list.push({ userId, strategyType });
  }
  return list;
}

function getStrategyStocks(strategyType) {
  const strategy = STRATEGY_REGISTRY[strategyType];
  if (!strategy) {
    Logger.log(`❌ 找不到策略定義：${strategyType}`);
    return [];
  }

  let allStocks;
  if (strategy.fetchFn) {
    allStocks = (typeof strategy.fetchFn === "string")
      ? this[strategy.fetchFn]()
      : strategy.fetchFn();
  } else {
    allStocks = _loadStocksFromDb();
  }

  allStocks.sort(strategy.sortFn);
  return allStocks.slice(0, 9);
}

function _loadStocksFromDb() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StockDatabase");
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map(r => {
    const code = String(r[0]).replace(/'/g,"").trim().toUpperCase();
    const name = String(r[3]).trim();
    if (!code || !name) return null;
    let price = r[2], amount = Number(r[7]) || 0;
    if (String(price).startsWith("=")) price = Number(r[9]) || 0;
    if (!amount || isNaN(amount)) amount = Number(price) * (Number(r[6]) || 0);
    return { code, name, price,
      change:    Number(r[4]) || 0,
      changePct: parseFloat(String(r[5]).replace("%","")) || 0,
      volume:    Number(r[6]) || 0,
      amount };
  }).filter(Boolean);
}

function getUserStrategiesFromDb(userId) {
  const sheet = _getStrategySheet();
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const uid  = String(userId).trim();
  return data.slice(1)
    .filter(r => String(r[0]).trim() === uid && r[1])
    .map(r => ({ strategyType: String(r[1]).trim(), pushTime: parseSheetTime(r[2], "10:00") }));
}

function upsertStrategyPush(userId, strategyType, time) {
  const sheet = _getStrategySheet();
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const uid  = String(userId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === uid && String(data[i][1]).trim() === strategyType) {
      sheet.getRange(i+1, 3).setValue(String(time));
      return;
    }
  }
  sheet.appendRow([uid, strategyType, String(time)]);
}

function deleteStrategyPush(userId, strategyType) {
  const sheet = _getStrategySheet();
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  const uid  = String(userId).trim();
  for (let i = data.length-1; i >= 1; i--) {
    if (String(data[i][0]).trim() === uid && String(data[i][1]).trim() === strategyType) {
      sheet.deleteRow(i+1);
      return true;
    }
  }
  return false;
}

function _getStrategySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName("UserStrategyConfig") ||
         ss.getSheetByName("UserTop10Config") || null;
}

// ============================================================
// 9_TaiexModule.gs ─ 台灣加權指數（大盤）
// doPost 路徑只讀快取（getTaiexDataCached），絕不打 API
// 背景定時器 warmUpAllCaches → refreshTaiexCache 負責更新
// ============================================================

const TAIEX_CACHE_KEY = "taiexData";
const TAIEX_CACHE_TTL = 600; // 10 分鐘（背景每 4 分鐘更新，永遠不會過期）

/**
 * ⚡ doPost 路徑專用：只讀快取 → 讀 IndexDatabase 備援，絕不打 API
 * 永遠在 0.1 秒內回傳
 */
function getTaiexDataCached() {
  // 1. 讀 CacheService（最快）
  try {
    const cached = CacheService.getScriptCache().get(TAIEX_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  // 2. 讀 IndexDatabase 試算表備援（仍然很快，單格讀取）
  try {
    const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("IndexDatabase");
    if (sheet) {
      const backup = sheet.getRange("A2:F2").getValues()[0];
      if (backup && backup[0]) {
        return {
          code: String(backup[0]), name: String(backup[1]),
          price:     Number(backup[2]).toLocaleString("zh-TW", { minimumFractionDigits: 2 }),
          change:    Number(backup[3]).toFixed(2),
          changePct: Number(backup[4]).toFixed(2),
          time:      String(backup[5])
        };
      }
    }
  } catch (e) {}
  return null;
}

/** 與舊版相容的別名（部分模組仍呼叫此名稱） */
function getTaiexDataFromSheet() {
  return getTaiexDataCached();
}

/**
 * 🔄 背景定時器專用：打 Yahoo API 更新快取 + IndexDatabase 備援
 * 由 warmUpAllCaches() 每 4 分鐘呼叫，或單獨設定時器
 */
function refreshTaiexCache() {
  try {
    const res = UrlFetchApp.fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d",
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return;

    const json = JSON.parse(res.getContentText());
    if (!json.chart || !json.chart.result || !json.chart.result.length) return;

    const meta      = json.chart.result[0].meta;
    const price     = parseFloat(meta.regularMarketPrice) || 0;
    const prevClose = parseFloat(meta.chartPreviousClose) ||
                      parseFloat(meta.previousClose) || 0;
    if (price <= 0 || prevClose <= 0) return;

    const change    = price - prevClose;
    const changePct = (change / prevClose) * 100;
    const timeStr   = Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm:ss");

    const data = {
      code: "TAIEX", name: "加權指數 (大盤)",
      price:     price.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change:    change.toFixed(2),
      changePct: changePct.toFixed(2),
      time:      timeStr
    };

    // 寫入 CacheService
    CacheService.getScriptCache().put(TAIEX_CACHE_KEY, JSON.stringify(data), TAIEX_CACHE_TTL);

    // 寫入 IndexDatabase 作為持久備援
    const sheet = _ensureIndexSheet(SpreadsheetApp.getActiveSpreadsheet());
    sheet.getRange("A2:F2").setValues([[
      "TAIEX", "加權指數 (大盤)", price, change.toFixed(2), changePct.toFixed(2), timeStr
    ]]);

    Logger.log("✅ 大盤快取已更新: " + data.price);
  } catch (e) {
    Logger.log("refreshTaiexCache 失敗: " + e.message);
  }
}

/** 與舊版相容的別名 */
function updateTaiexToIndexSheet() {
  refreshTaiexCache();
}

/** 確保 IndexDatabase 工作表存在 */
function _ensureIndexSheet(ss) {
  let sheet = ss.getSheetByName("IndexDatabase");
  if (!sheet) {
    sheet = ss.insertSheet("IndexDatabase");
    sheet.appendRow(["代碼","名稱","現價","漲跌","漲跌幅","最後更新時間"]);
  }
  return sheet;
}

// ─── 工具：現在時間 HH:mm（供多模組共用）─────────────────────
function _nowHHMM() {
  const now = new Date();
  return now.getHours().toString().padStart(2,"0") + ":" +
         now.getMinutes().toString().padStart(2,"0");
}

// ============================================================
// 10_MorningReport.gs
// 功能 4：早安報（美股收盤 + 期貨 + 財經事件）
// 功能 5：三大法人買賣超 TOP5
// 定時器：triggerMorningReport → 每日 08:50 執行
// ============================================================

// ─── 交易日判斷（共用）────────────────────────────────────────

function _isTradingDay() {
  const day = new Date().getDay(); // 0=日, 6=六
  return day !== 0 && day !== 6;
}

// ─── 主入口：早安報推播 ───────────────────────────────────────

function triggerMorningReport() {
  if (!_isTradingDay()) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPushConfig");
  if (!sheet) return;

  // 取得所有有開啟推播的不重複 userId
  const data    = sheet.getDataRange().getValues();
  const userSet = new Set();
  for (let i = 1; i < data.length; i++) {
    const hasPush = data[i][4] === true || String(data[i][4]).toUpperCase() === "TRUE";
    if (hasPush && data[i][0]) userSet.add(String(data[i][0]).trim());
  }
  if (!userSet.size) return;

  const report = buildMorningReportFlex();
  if (!report) { Logger.log("⚠️ 早安報資料不足，略過"); return; }

  userSet.forEach(uid => {
    const res = pushFlexToLine(uid, report, "📰 股市早安報");
    Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 早安報 → ${uid}`);
  });
}

// ─── 早安報 Flex 組裝 ─────────────────────────────────────────

function buildMorningReportFlex() {
  const usMarket  = _fetchUSMarket();
  const futures   = _fetchTWFutures();
  const institute = _fetchInstituteBuySell();
  const dateStr   = Utilities.formatDate(new Date(), "Asia/Taipei", "MM/dd");

  const usRows = usMarket.map(m => {
    const isUp  = m.change >= 0;
    const arrow = isUp ? "▲" : "▼";
    const color = isUp ? "#EF4444" : "#10B981";
    return _flexRow(m.name, `${arrow} ${Math.abs(m.change).toFixed(2)} (${Math.abs(m.pct).toFixed(2)}%)`, color);
  });

  const futureRow = futures
    ? _flexRow("台指期（近月）",
        `${futures.change >= 0 ? "▲" : "▼"} ${Math.abs(futures.change).toFixed(0)} 點`,
        futures.change >= 0 ? "#EF4444" : "#10B981")
    : _flexRow("台指期", "資料暫不可用", "#94A3B8");

  const instituteRows = institute.slice(0, 5).map((s, i) => {
    const isNet = s.net >= 0;
    return _flexRow(
      `${i + 1}. ${s.name}(${s.code})`,
      `${isNet ? "買超" : "賣超"} ${formatAmountUnit(Math.abs(s.net))}`,
      isNet ? "#EF4444" : "#10B981"
    );
  });

  return {
    type: "bubble", size: "mega",
    header: {
      type: "box", layout: "vertical", backgroundColor: "#0F172A",
      contents: [
        { type: "text", text: "📰 股市早安報", weight: "bold", size: "md", color: "#F59E0B" },
        { type: "text", text: dateStr + " 今日開盤前情報", size: "xs", color: "#94A3B8", margin: "xs" }
      ]
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        _sectionTitle("🌍 美股昨日收盤"),
        ...usRows,
        { type: "separator", margin: "md" },
        _sectionTitle("📈 台指期走向"),
        futureRow,
        { type: "separator", margin: "md" },
        _sectionTitle("🏦 昨日外資買賣超 TOP5"),
        ...(instituteRows.length
          ? instituteRows
          : [{ type: "text", text: "資料暫不可用", size: "xs", color: "#94A3B8" }])
      ]
    },
    footer: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: "資料來源：Yahoo Finance / TWSE", size: "xxs", color: "#94A3B8", align: "center" }
      ]
    }
  };
}

// ─── 美股指數 ─────────────────────────────────────────────────

function _fetchUSMarket() {
  const symbols = [
    { sym: "%5EDJI", name: "道瓊" },
    { sym: "%5EIXIC", name: "那斯達克" },
    { sym: "%5EGSPC", name: "S&P 500" }
  ];
  const result = [];
  symbols.forEach(({ sym, name }) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return;
      const meta      = JSON.parse(res.getContentText()).chart.result[0].meta;
      const price     = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose || meta.previousClose;
      result.push({ name, price, change: price - prevClose, pct: ((price - prevClose) / prevClose) * 100 });
    } catch (e) { Logger.log(`_fetchUSMarket ${name}: ${e.message}`); }
  });
  return result;
}

// ─── 台指期 ───────────────────────────────────────────────────

function _fetchTWFutures() {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/TWF%3DF?interval=1d&range=2d";
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const meta      = JSON.parse(res.getContentText()).chart.result[0].meta;
    const price     = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    return { price, change: price - prevClose };
  } catch (e) { return null; }
}

// ─── 三大法人買賣超（TWSE 昨日資料）────────────────────────────

function _fetchInstituteBuySell() {
  // 快取 1 小時，避免重複打 API
  const CACHE_KEY = "instituteBuySell";
  const cache     = CacheService.getScriptCache();
  const cached    = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const result = [];
  try {
    const url = "https://openapi.twse.com.tw/v1/fund/TWT44U";
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return result;

    JSON.parse(res.getContentText()).forEach(s => {
      const code = String(s.Code || "").trim();
      const name = String(s.Name || "").trim();
      if (!/^\d{4,6}$/.test(code)) return;

      // 外資買賣超（欄位名稱：ForeignInvestors_NetBuySell）
      const net = Number(String(s.ForeignInvestors_NetBuySell || "0").replace(/,/g, "")) * 1000;
      if (net !== 0) result.push({ code, name, net });
    });

    // 依買超金額排序（買超最多在前）
    result.sort((a, b) => b.net - a.net);
    cache.put(CACHE_KEY, JSON.stringify(result), 3600);
  } catch (e) { Logger.log("_fetchInstituteBuySell: " + e.message); }

  return result;
}

// ─── Flex 工具 ────────────────────────────────────────────────

function _sectionTitle(text) {
  return { type: "text", text, weight: "bold", size: "xs", color: "#1E3A8A", margin: "md" };
}
function _flexRow(label, value, valueColor) {
  const v = { type: "text", text: String(value), weight: "bold", size: "xs", align: "end", flex: 3 };
  if (valueColor) v.color = valueColor;
  return { type: "box", layout: "horizontal", contents: [
    { type: "text", text: String(label), color: "#475569", size: "xs", flex: 3 }, v
  ]};
}

// ============================================================
// 11_TechnicalAlert.gs
// 功能 1：均線突破警示（MA5 / MA20）
// 功能 2：成交量異常暴增警示（> 近5日均量 × 2）
// 功能 3：開盤異常漲跌警示（開盤30分鐘內 ±3%）
// 定時器：
//   triggerTechnicalAlert → 每分鐘執行（盤中 09:00~13:30）
//   triggerOpeningAlert   → 每日 09:30 執行一次
// 新增工作表：UserTechnicalAlert（記錄用戶訂閱的技術警示）
// ============================================================

// ─── UserTechnicalAlert 工作表結構 ────────────────────────────
// userId | code | name | alertTypes（逗號分隔）| createdAt
// alertTypes 可為：MA_CROSS, VOLUME_SURGE, OPENING_SURGE

function _getTechAlertSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("UserTechnicalAlert");
  if (!sheet) {
    sheet = ss.insertSheet("UserTechnicalAlert");
    sheet.appendRow(["userId", "code", "name", "alertTypes", "createdAt"]);
  }
  return sheet;
}

// ─── CRUD ─────────────────────────────────────────────────────

function addTechAlert(userId, code, name, alertTypes) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    const sheet = _getTechAlertSheet();
    const data  = sheet.getDataRange().getValues();
    const uid   = String(userId).trim();
    const c     = String(code).replace(/'/g, "").trim().toUpperCase();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === uid &&
          String(data[i][1]).replace(/'/g,"").trim().toUpperCase() === c) {
        sheet.getRange(i+1, 4).setValue(alertTypes.join(","));
        return true;
      }
    }
    sheet.appendRow([uid, "'"+c, String(name), alertTypes.join(","), new Date()]);
    return true;
  } finally { lock.releaseLock(); }
}

function deleteTechAlert(userId, code) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    const sheet = _getTechAlertSheet();
    const data  = sheet.getDataRange().getValues();
    const uid   = String(userId).trim();
    const c     = String(code).replace(/'/g,"").trim().toUpperCase();
    for (let i = data.length-1; i >= 1; i--) {
      if (String(data[i][0]).trim() === uid &&
          String(data[i][1]).replace(/'/g,"").trim().toUpperCase() === c) {
        sheet.deleteRow(i+1); return true;
      }
    }
    return false;
  } finally { lock.releaseLock(); }
}

function getUserTechAlerts(userId) {
  const sheet = _getTechAlertSheet();
  const data  = sheet.getDataRange().getValues();
  const uid   = String(userId).trim();
  return data.slice(1)
    .filter(r => String(r[0]).trim() === uid)
    .map(r => ({
      code:       String(r[1]).replace(/'/g,"").trim().toUpperCase(),
      name:       String(r[2]),
      alertTypes: String(r[3]).split(",").map(s => s.trim()).filter(Boolean)
    }));
}

// ─── 觸發器：均線突破 + 量能異常（盤中每分鐘）────────────────

function triggerTechnicalAlert() {
  if (!_isTradingDay()) return;
  const now = new Date();
  const h   = now.getHours(), m = now.getMinutes();
  // 只在盤中執行（9:00 ~ 13:31）
  if (h < 9 || (h === 13 && m > 31) || h > 13) return;

  const sheet = _getTechAlertSheet();
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // 收集所有需要監控的代碼
  const codeUserMap = {}; // code → [{userId, name, alertTypes}]
  for (let i = 1; i < data.length; i++) {
    const uid   = String(data[i][0]).trim();
    const code  = String(data[i][1]).replace(/'/g,"").trim().toUpperCase();
    const name  = String(data[i][2]);
    const types = String(data[i][3]).split(",").map(s => s.trim()).filter(Boolean);
    if (!codeUserMap[code]) codeUserMap[code] = [];
    codeUserMap[code].push({ uid, name, types });
  }

  const codes    = Object.keys(codeUserMap);
  if (!codes.length) return;

  // 抓取每檔股票的歷史資料（Yahoo Finance）
  const userAlerts = {}; // uid → [{type, code, name, ...}]

  codes.forEach(code => {
    try {
      const hist = _fetchStockHistory(code, 25); // 25 個交易日
      if (!hist || hist.length < 6) return;

      const closes  = hist.map(d => d.close);
      const volumes = hist.map(d => d.volume);
      const latest  = closes[closes.length - 1];
      const prev    = closes[closes.length - 2];

      const ma5  = _avg(closes.slice(-5));
      const ma20 = closes.length >= 20 ? _avg(closes.slice(-20)) : null;
      const ma5p = _avg(closes.slice(-6, -1)); // 前一天的 MA5
      const avgVol5 = _avg(volumes.slice(-6, -1)); // 近5日均量（排除今天）
      const todayVol = volumes[volumes.length - 1];

      codeUserMap[code].forEach(({ uid, name, types }) => {
        if (!userAlerts[uid]) userAlerts[uid] = [];

        // MA 突破判定
        if (types.includes("MA_CROSS")) {
          if (prev < ma5p && latest >= ma5) {
            userAlerts[uid].push({ type: "MA_CROSS", code, name,
              detail: `📈 突破 MA5（${ma5.toFixed(1)}），現價 ${latest}` });
          }
          if (ma20 !== null) {
            const ma20p = closes.length >= 21 ? _avg(closes.slice(-21, -1)) : null;
            if (ma20p && prev < ma20p && latest >= ma20) {
              userAlerts[uid].push({ type: "MA_CROSS", code, name,
                detail: `🚀 突破 MA20（${ma20.toFixed(1)}），現價 ${latest}` });
            }
          }
        }

        // 量能異常
        if (types.includes("VOLUME_SURGE") && avgVol5 > 0) {
          if (todayVol >= avgVol5 * 2) {
            userAlerts[uid].push({ type: "VOLUME_SURGE", code, name,
              detail: `🔥 量能暴增！今日 ${_formatVol(todayVol)} 張，均量 ${_formatVol(avgVol5)} 張` });
          }
        }
      });
    } catch (e) { Logger.log(`技術警示 ${code}: ${e.message}`); }
  });

  // 推播
  Object.entries(userAlerts).forEach(([uid, alerts]) => {
    if (!alerts.length) return;
    const bubbles = alerts.slice(0, 10).map(_buildTechAlertBubble);
    const res = pushFlexToLine(uid, { type: "carousel", contents: bubbles }, "📊 技術指標警示");
    Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 技術警示 → ${uid} (${alerts.length}筆)`);
  });
}

// ─── 觸發器：開盤異常（09:30 單次）─────────────────────────

function triggerOpeningAlert() {
  if (!_isTradingDay()) return;
  const sheet = _getTechAlertSheet();
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const priceMap   = getCachedPriceMap();
  const userAlerts = {};

  for (let i = 1; i < data.length; i++) {
    const uid   = String(data[i][0]).trim();
    const code  = String(data[i][1]).replace(/'/g,"").trim().toUpperCase();
    const name  = String(data[i][2]);
    const types = String(data[i][3]).split(",").map(s => s.trim());
    if (!types.includes("OPENING_SURGE")) continue;

    const entry = priceMap[code];
    if (!entry) continue;
    const pct = Math.abs(Number(entry.changepct) || 0);
    if (pct < 3) continue;

    const isUp = Number(entry.changepct) >= 0;
    if (!userAlerts[uid]) userAlerts[uid] = [];
    userAlerts[uid].push({
      type: "OPENING_SURGE", code, name,
      detail: `${isUp ? "📈 開盤大漲" : "📉 開盤大跌"} ${pct.toFixed(2)}%，現價 $${entry.price}`
    });
  }

  Object.entries(userAlerts).forEach(([uid, alerts]) => {
    if (!alerts.length) return;
    const bubbles = alerts.slice(0, 10).map(_buildTechAlertBubble);
    pushFlexToLine(uid, { type: "carousel", contents: bubbles }, "🚨 開盤異常警示");
  });
}

// ─── 工具：抓取 Yahoo 歷史 K 線 ──────────────────────────────

function _fetchStockHistory(code, days) {
  const CACHE_KEY = `hist_${code}`;
  const cache     = CacheService.getScriptCache();
  const cached    = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  try {
    // Yahoo Finance 台股代碼格式：2330.TW 或 00631L.TW
    const sym = code + ".TW";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=3mo`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    const json    = JSON.parse(res.getContentText());
    const result  = json.chart.result[0];
    const closes  = result.indicators.quote[0].close;
    const volumes = result.indicators.quote[0].volume;
    const ts      = result.timestamp;

    const hist = ts.map((t, i) => ({
      date:   new Date(t * 1000),
      close:  closes[i] || 0,
      volume: volumes[i] || 0
    })).filter(d => d.close > 0).slice(-days);

    cache.put(CACHE_KEY, JSON.stringify(hist), 180); // 快取 3 分鐘
    return hist;
  } catch (e) { return null; }
}

function _avg(arr) {
  const valid = arr.filter(v => v > 0);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : 0;
}

function _formatVol(v) {
  return Math.round(v / 1000).toLocaleString();
}

// ─── Flex 警示泡泡 ────────────────────────────────────────────

function _buildTechAlertBubble(alert) {
  const colorMap = { MA_CROSS: "#1E3A8A", VOLUME_SURGE: "#EA580C", OPENING_SURGE: "#7C3AED" };
  const labelMap = { MA_CROSS: "📊 均線突破訊號", VOLUME_SURGE: "🔥 量能異常警示", OPENING_SURGE: "🚨 開盤異常" };
  const bgColor  = colorMap[alert.type] || "#0F172A";
  const label    = labelMap[alert.type] || "⚡ 技術警示";
  const en       = encodeURIComponent(alert.name);

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: bgColor, contents: [
      { type: "text", text: label, size: "xs", color: "#ffffff", weight: "bold" },
      { type: "text", text: alert.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
      { type: "text", text: "代碼: " + alert.code, size: "xs", color: "#CBD5E1" }
    ]},
    body: { type: "box", layout: "vertical", contents: [
      { type: "text", text: alert.detail, wrap: true, size: "sm", color: "#1E293B", weight: "bold" }
    ]},
    footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
      { type: "button", style: "primary", color: bgColor, height: "sm",
        action: { type: "postback", label: "🔔 設定到價通知",
          data: `action=set_alert_init&code=${alert.code}&name=${en}` }}
    ]}
  };
}

// ─── Postback 整合（在 2_Main.gs handlePostback 末段加入）────
// action=add_tech_alert&code=2330&name=台積電&types=MA_CROSS,VOLUME_SURGE
// action=delete_tech_alert&code=2330

function handleTechAlertPostback(replyToken, userId, p) {
  if (p.action === "add_tech_alert") {
    const types = (p.types || "MA_CROSS").split(",");
    addTechAlert(userId, p.code, p.name, types);
    replyTextMessage(replyToken,
      `✅ 已為【${p.name}】開啟技術警示監控！\n` +
      `監控項目：${types.map(t => ({ MA_CROSS:"均線突破", VOLUME_SURGE:"量能異常", OPENING_SURGE:"開盤異常" }[t] || t)).join("、")}`);
    return true;
  }
  if (p.action === "delete_tech_alert") {
    deleteTechAlert(userId, p.code);
    replyTextMessage(replyToken, `❌ 已關閉【${p.name}】的技術警示監控。`);
    return true;
  }
  return false;
}

// ============================================================
// 12_Portfolio.gs
// 功能 7：投資組合損益追蹤（持倉成本 + 數量 → 即時損益）
// 功能 10：到價觸發後記錄交易
// 新增工作表：UserPortfolio
// 欄位：userId | code | name | costPrice | shares | note | createdAt
// ============================================================

// ─── 工作表 ────────────────────────────────────────────────────

function _getPortfolioSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("UserPortfolio");
  if (!sheet) {
    sheet = ss.insertSheet("UserPortfolio");
    sheet.appendRow(["userId","code","name","costPrice","shares","note","createdAt"]);
  }
  return sheet;
}

// ─── CRUD ─────────────────────────────────────────────────────

/**
 * 新增或更新持倉（同一 userId+code 只保留一筆，更新成本與數量）
 */
function upsertPortfolio(userId, code, name, costPrice, shares, note) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    const sheet     = _getPortfolioSheet();
    const data      = sheet.getDataRange().getValues();
    const uid       = String(userId).trim();
    const cleanCode = String(code).replace(/'/g,"").trim().toUpperCase();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === uid &&
          String(data[i][1]).replace(/'/g,"").trim().toUpperCase() === cleanCode) {
        sheet.getRange(i+1, 3).setValue(String(name));
        sheet.getRange(i+1, 4).setValue(Number(costPrice));
        sheet.getRange(i+1, 5).setValue(Number(shares));
        if (note !== undefined) sheet.getRange(i+1, 6).setValue(String(note));
        sheet.getRange(i+1, 7).setValue(new Date());
        return true;
      }
    }
    sheet.appendRow([uid, "'"+cleanCode, String(name),
      Number(costPrice), Number(shares), String(note||""), new Date()]);
    return true;
  } finally { lock.releaseLock(); }
}

function deletePortfolio(userId, code) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    const sheet     = _getPortfolioSheet();
    const data      = sheet.getDataRange().getValues();
    const uid       = String(userId).trim();
    const cleanCode = String(code).replace(/'/g,"").trim().toUpperCase();
    for (let i = data.length-1; i >= 1; i--) {
      if (String(data[i][0]).trim() === uid &&
          String(data[i][1]).replace(/'/g,"").trim().toUpperCase() === cleanCode) {
        sheet.deleteRow(i+1); return true;
      }
    }
    return false;
  } finally { lock.releaseLock(); }
}

function getUserPortfolio(userId) {
  const sheet = _getPortfolioSheet();
  const data  = sheet.getDataRange().getValues();
  const uid   = String(userId).trim();
  return data.slice(1)
    .filter(r => String(r[0]).trim() === uid)
    .map(r => ({
      code:      String(r[1]).replace(/'/g,"").trim().toUpperCase(),
      name:      String(r[2]),
      costPrice: Number(r[3]) || 0,
      shares:    Number(r[4]) || 0,
      note:      String(r[5] || "")
    }));
}

// ─── 損益計算 ──────────────────────────────────────────────────

/**
 * 計算單一持倉損益
 */
function calcPnL(costPrice, shares, currentPrice) {
  const cost    = costPrice * shares * 1000; // 台股 1 張 = 1000 股
  const value   = currentPrice * shares * 1000;
  const buyFee  = Math.ceil(cost * 0.001425);  // 買進手續費 0.1425%
  const sellFee = Math.ceil(value * 0.001425); // 賣出手續費 0.1425%
  const sellTax = Math.floor(value * 0.003);   // 證交稅 0.3%（無條件捨去）
  const fees    = buyFee + sellFee + sellTax;
  const pnl     = value - cost - fees;
  const pct     = cost > 0 ? (pnl / cost) * 100 : 0;
  return { cost, value, pnl, pct, fees, buyFee, sellFee, sellTax };
}

// ─── 查詢我的投資組合（handlePostback 整合）─────────────────

function handlePortfolioQuery(replyToken, userId) {
  const holdings = getUserPortfolio(userId);
  if (!holdings.length) {
    replyTextMessage(replyToken, "📂 您尚未建立任何持倉記錄！\n請輸入代碼後選擇「加入持倉」進行設定。");
    return;
  }

  const priceMap = getCachedPriceMap();
  _injectTaiexIntoPriceMap(priceMap);

  let totalCost = 0, totalValue = 0;
  const bubbles = holdings.slice(0, 9).map(h => {
    const live    = priceMap[h.code] || { price: h.costPrice, change: 0, changepct: 0 };
    const cur     = Number(live.price) || h.costPrice;
    const pnl     = calcPnL(h.costPrice, h.shares, cur);
    totalCost    += pnl.cost;
    totalValue   += pnl.value;
    return _buildPortfolioBubble(h, cur, live, pnl);
  });

  // 總覽 bubble（第一頁）
  const totalPnl  = totalValue - totalCost;
  const totalPct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const isUp      = totalPnl >= 0;
  const color     = isUp ? "#EF4444" : "#10B981";
  const arrow     = isUp ? "▲" : "▼";

  const summaryBubble = {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
      { type: "text", text: "📂 我的投資組合總覽", weight: "bold", size: "md", color: "#F59E0B" },
      { type: "text", text: `共 ${holdings.length} 檔持倉`, size: "xs", color: "#94A3B8", margin: "xs" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      _flexRow("💰 總成本", formatAmountUnit(totalCost), "#475569"),
      _flexRow("📈 當前市值", formatAmountUnit(totalValue), "#1E40AF"),
      { type: "separator", margin: "md" },
      _flexRow("損益金額", `${arrow} ${formatAmountUnit(Math.abs(totalPnl))}`, color),
      _flexRow("損益%", `${arrow} ${Math.abs(totalPct).toFixed(2)}%`, color)
    ]},
    footer: { type: "box", layout: "vertical", contents: [
      { type: "text", text: "向右滑動查看各持倉明細 →", size: "xs", color: "#94A3B8", align: "center" }
    ]}
  };

  replyFlexMessage(replyToken, "📂 我的投資組合",
    { type: "carousel", contents: [summaryBubble, ...bubbles] });
}

function _buildPortfolioBubble(h, cur, live, pnl) {
  const isUp  = pnl.pnl >= 0;
  const color = isUp ? "#EF4444" : "#10B981";
  const arrow = isUp ? "▲" : "▼";
  const en    = encodeURIComponent(h.name);

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", contents: [
      { type: "text", text: h.name, weight: "bold", size: "md", color: "#ffffff" },
      { type: "text", text: `代碼: ${h.code}　持倉: ${h.shares} 張`, size: "xs", color: "#93C5FD", margin: "xs" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "xs", contents: [
      _flexRow("成本均價", `$${h.costPrice}`, "#475569"),
      _flexRow("當前現價", `$${cur}`,
        Number(live.changepct) >= 0 ? "#EF4444" : "#10B981"),
      { type: "separator", margin: "sm" },
      _flexRow("持倉成本", formatAmountUnit(pnl.cost), "#475569"),
      _flexRow("當前市值", formatAmountUnit(pnl.value), "#1E40AF"),
      _flexRow("未實現損益",
        `${arrow} ${formatAmountUnit(Math.abs(pnl.pnl))} (${Math.abs(pnl.pct).toFixed(2)}%)`,
        color)
    ]},
    footer: { type: "box", layout: "vertical", spacing: "xs", contents: [
      { type: "button", style: "secondary", height: "sm",
        action: { type: "postback", label: "✏️ 更新持倉",
          data: `action=portfolio_edit&code=${h.code}&name=${en}&cost=${h.costPrice}&shares=${h.shares}` }},
      { type: "button", style: "link", color: "#EF4444", height: "sm",
        action: { type: "postback", label: "🗑 刪除此持倉",
          data: `action=portfolio_delete&code=${h.code}&name=${en}` }}
    ]}
  };
}

// ─── 新增持倉流程（State Machine）────────────────────────────
// 步驟：① 輸入代碼 → 確認卡含「加入持倉」按鈕
//       ② action=portfolio_add_init → 顯示成本價輸入卡
//       ③ 用戶輸入數字（成本價）→ 問數量
//       ④ 用戶輸入數量（張）→ 寫入

const PORTFOLIO_STATE_PREFIX = "portfolio_state_";

function setPortfolioState(userId, state) {
  CacheService.getScriptCache().put(
    PORTFOLIO_STATE_PREFIX + userId, JSON.stringify(state), 300);
}
function getPortfolioState(userId) {
  const v = CacheService.getScriptCache().get(PORTFOLIO_STATE_PREFIX + userId);
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function clearPortfolioState(userId) {
  CacheService.getScriptCache().remove(PORTFOLIO_STATE_PREFIX + userId);
}

/**
 * 在 handleTextMessage 開頭加入（優先於其他判斷）：
 * const ps = getPortfolioState(userId);
 * if (ps && /^\d+(\.\d+)?$/.test(msg)) {
 *   handlePortfolioInput(replyToken, userId, ps, Number(msg));
 *   return;
 * }
 */
function handlePortfolioInput(replyToken, userId, state, num) {
  if (state.step === "cost") {
    setPortfolioState(userId, { ...state, step: "shares", costPrice: num });
    replyTextMessage(replyToken,
      `💼 成本均價設定為 $${num}\n\n請輸入持倉「張數」（例如：5）`);
  } else if (state.step === "shares") {
    upsertPortfolio(userId, state.code, state.name, state.costPrice, num, "");
    clearPortfolioState(userId);
    replyTextMessage(replyToken,
      `✅ 持倉建立成功！\n\n` +
      `📌 ${state.name}（${state.code}）\n` +
      `成本均價：$${state.costPrice}\n` +
      `持倉張數：${num} 張\n\n` +
      `輸入「我的投資組合」可查看損益。`);
  }
}

/**
 * Postback 整合（加入 handlePostback）
 */
function handlePortfolioPostback(replyToken, userId, p) {
  if (p.action === "portfolio_add_init") {
    setPortfolioState(userId, { step: "cost", code: p.code, name: p.name });
    replyTextMessage(replyToken,
      `💼 建立 【${p.name}】 的持倉記錄\n\n請輸入您的「買入均價」（例如：530.5）`);
    return true;
  }
  if (p.action === "portfolio_edit") {
    setPortfolioState(userId, { step: "cost", code: p.code, name: p.name });
    replyTextMessage(replyToken,
      `✏️ 更新 【${p.name}】 持倉\n現有：成本 $${p.cost}，持倉 ${p.shares} 張\n\n請重新輸入「買入均價」`);
    return true;
  }
  if (p.action === "portfolio_delete") {
    deletePortfolio(userId, p.code);
    replyTextMessage(replyToken, `🗑 已刪除【${p.name}】的持倉記錄。`);
    return true;
  }
  if (p.action === "view_portfolio") {
    handlePortfolioQuery(replyToken, userId);
    return true;
  }
  return false;
}

// ============================================================
// 13_WeeklyReport.gs
// 功能 11：週報（每週五 14:30 推播）
// 功能 12：除息 / 除權日提醒（每日 08:40 檢查，提前 3 天通知）
// ============================================================

// ─── 週報主入口 ───────────────────────────────────────────────

/**
 * 定時器：triggerWeeklyReport → 每週五 14:30 執行
 */
function triggerWeeklyReport() {
  const today = new Date();
  if (today.getDay() !== 5) return; // 週五才執行（週五不可能是六日，不需額外判斷）

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPushConfig");
  if (!sheet) return;

  // 收集有開啟推播的不重複 userId
  const data    = sheet.getDataRange().getValues();
  const userSet = new Set();
  for (let i = 1; i < data.length; i++) {
    const hasPush = data[i][4] === true || String(data[i][4]).toUpperCase() === "TRUE";
    if (hasPush && data[i][0]) userSet.add(String(data[i][0]).trim());
  }
  if (!userSet.size) return;

  userSet.forEach(uid => {
    try {
      const flex = _buildWeeklyReportFlex(uid);
      if (!flex) return;
      const res = pushFlexToLine(uid, flex, "📊 本週股市週報");
      Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 週報 → ${uid}`);
    } catch (e) { Logger.log(`週報 ${uid}: ${e.message}`); }
  });
}

function _buildWeeklyReportFlex(userId) {
  const priceMap  = getCachedPriceMap();
  const portfolio = getUserPortfolio(userId);
  const pushList  = getUserPushes(userId).filter(p => p.hasPush);
  const dateStr   = Utilities.formatDate(new Date(), "Asia/Taipei", "MM/dd");

  // 1. 大盤本週表現（從快取拿）
  const taiex = getTaiexDataCached();

  // 2. 持倉週損益
  let totalPnl = 0, totalCost = 0;
  const holdingRows = portfolio.slice(0, 5).map(h => {
    const cur  = Number((priceMap[h.code] || {}).price) || h.costPrice;
    const pnl  = (cur - h.costPrice) * h.shares * 1000;
    const pct  = h.costPrice > 0 ? ((cur - h.costPrice) / h.costPrice) * 100 : 0;
    totalPnl  += pnl;
    totalCost += h.costPrice * h.shares * 1000;
    const isUp = pnl >= 0;
    return _flexRow(
      `${h.name}(${h.code})`,
      `${isUp ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`,
      isUp ? "#EF4444" : "#10B981"
    );
  });

  // 3. 收藏推播股表現
  const watchRows = pushList.slice(0, 5).map(p => {
    const live  = priceMap[p.code] || {};
    const isUp  = Number(live.changepct || 0) >= 0;
    return _flexRow(
      `${p.name}(${p.code})`,
      `${isUp ? "▲" : "▼"} ${Math.abs(Number(live.changepct)||0).toFixed(2)}%`,
      isUp ? "#EF4444" : "#10B981"
    );
  });

  const isUpTotal = totalPnl >= 0;
  const taiexIsUp = Number(taiex?.changePct || 0) >= 0;

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#0F172A", contents: [
      { type: "text", text: "📊 本週股市週報", weight: "bold", size: "md", color: "#F59E0B" },
      { type: "text", text: dateStr + " 收盤後彙整", size: "xs", color: "#94A3B8", margin: "xs" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      // 大盤
      ...(taiex ? [
        _sectionTitle("📈 加權指數本日"),
        _flexRow("收盤指數", taiex.price, "#1E40AF"),
        _flexRow("漲跌幅",
          `${taiexIsUp ? "▲" : "▼"} ${Math.abs(Number(taiex.changePct)).toFixed(2)}%`,
          taiexIsUp ? "#EF4444" : "#10B981"),
        { type: "separator", margin: "md" }
      ] : []),

      // 持倉損益
      ...(holdingRows.length ? [
        _sectionTitle("💼 持倉帳面損益"),
        ...holdingRows,
        _flexRow("合計損益",
          `${isUpTotal ? "+" : ""}${formatAmountUnit(totalPnl)}`,
          isUpTotal ? "#EF4444" : "#10B981"),
        { type: "separator", margin: "md" }
      ] : []),

      // 觀察清單
      ...(watchRows.length ? [
        _sectionTitle("👁 收藏清單今日漲跌"),
        ...watchRows
      ] : [])
    ]}
  };
}

// ─── 除息 / 除權提醒 ──────────────────────────────────────────

/**
 * 定時器：triggerExDividendAlert → 每日 08:40 執行
 * 提前 3 個交易日通知持倉或收藏中的個股
 */
function triggerExDividendAlert() {
  if (!_isTradingDay()) return;
  const upcoming = _fetchUpcomingExDividend(3); // 3 天內
  if (!upcoming.length) return;

  const codeSet = new Set(upcoming.map(d => d.code));

  // 找出誰有收藏或持倉這些代碼
  const userMap = {}; // userId → [divInfo]

  // 從 UserPushConfig
  const pushSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPushConfig");
  if (pushSheet) {
    pushSheet.getDataRange().getValues().slice(1).forEach(r => {
      const uid  = String(r[0]).trim();
      const code = String(r[1]).replace(/'/g,"").trim().toUpperCase();
      const hasPush = r[4] === true || String(r[4]).toUpperCase() === "TRUE";
      if (!hasPush || !codeSet.has(code)) return;
      const div = upcoming.find(d => d.code === code);
      if (div) {
        if (!userMap[uid]) userMap[uid] = [];
        userMap[uid].push(div);
      }
    });
  }

  // 從 UserPortfolio
  const pfSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPortfolio");
  if (pfSheet) {
    pfSheet.getDataRange().getValues().slice(1).forEach(r => {
      const uid  = String(r[0]).trim();
      const code = String(r[1]).replace(/'/g,"").trim().toUpperCase();
      if (!codeSet.has(code)) return;
      const div = upcoming.find(d => d.code === code);
      if (!div) return;
      if (!userMap[uid]) userMap[uid] = [];
      // 避免重複推送
      if (!userMap[uid].some(d => d.code === code)) userMap[uid].push(div);
    });
  }

  Object.entries(userMap).forEach(([uid, divList]) => {
    const bubbles = divList.slice(0, 10).map(_buildExDivBubble);
    const res = pushFlexToLine(uid, { type: "carousel", contents: bubbles }, "🎯 除息 / 除權日提醒");
    Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 除息提醒 → ${uid}`);
  });
}

/**
 * 從 TWSE 抓取 N 天內的除息除權資料
 * API：https://openapi.twse.com.tw/v1/opendata/t187ap22_L
 */
function _fetchUpcomingExDividend(daysAhead) {
  const CACHE_KEY = "exDividend_upcoming";
  const cache     = CacheService.getScriptCache();
  const cached    = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const result = [];
  try {
    const url = "https://openapi.twse.com.tw/v1/opendata/t187ap22_L";
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return result;

    const today = new Date();
    today.setHours(0,0,0,0);
    const limit = new Date(today.getTime() + daysAhead * 86400000);

    JSON.parse(res.getContentText()).forEach(row => {
      const code     = String(row["股票代號"] || "").trim();
      const name     = String(row["股票名稱"] || "").trim();
      const dateStr  = String(row["除權息日期"] || "").trim(); // 格式：113/06/12（民國）
      const cashDiv  = parseFloat(String(row["現金股利"] || "0").replace(/,/g,"")) || 0;
      const stockDiv = parseFloat(String(row["股票股利"] || "0").replace(/,/g,"")) || 0;

      if (!/^\d{4,6}$/.test(code) || (!cashDiv && !stockDiv)) return;

      // 民國年 → 西元
      const parts = dateStr.split("/");
      if (parts.length < 3) return;
      const exDate = new Date(
        parseInt(parts[0]) + 1911,
        parseInt(parts[1]) - 1,
        parseInt(parts[2])
      );
      if (exDate >= today && exDate <= limit) {
        result.push({ code, name, exDate: dateStr, cashDiv, stockDiv });
      }
    });

    cache.put(CACHE_KEY, JSON.stringify(result), 3600);
  } catch (e) { Logger.log("_fetchUpcomingExDividend: " + e.message); }

  return result;
}

function _buildExDivBubble(div) {
  const hasCash  = div.cashDiv > 0;
  const hasStock = div.stockDiv > 0;
  const typeTag  = hasCash && hasStock ? "除息 + 除權" : hasCash ? "📥 現金除息" : "📦 股票除權";

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#065F46", contents: [
      { type: "text", text: "🎯 除息 / 除權日提醒", size: "xs", color: "#A7F3D0", weight: "bold" },
      { type: "text", text: div.name, weight: "bold", size: "md", color: "#ffffff", margin: "xs" },
      { type: "text", text: `代碼: ${div.code}`, size: "xs", color: "#A7F3D0" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      _flexRow("類型", typeTag, "#065F46"),
      _flexRow("除息日期", div.exDate, "#1E293B"),
      ...(hasCash  ? [_flexRow("現金股利", `$${div.cashDiv} 元/股`, "#1E40AF")] : []),
      ...(hasStock ? [_flexRow("股票股利", `${div.stockDiv} 元/股`, "#EA580C")] : []),
      { type: "text", text: "⚠️ 提醒：除息日前一天須持有股票方可領息", wrap: true, size: "xxs", color: "#94A3B8", margin: "md" }
    ]}
  };
}

// ─── 月報（每月最後一個交易日 14:30）─────────────────────────

/**
 * 定時器：triggerMonthlyReport → 每日 14:30 執行，內部判斷月底
 */
function triggerMonthlyReport() {
  if (!_isTradingDay()) return;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // 如果明天是下個月，代表今天是月底（或接近月底）
  if (today.getMonth() === tomorrow.getMonth()) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UserPushConfig");
  if (!sheet) return;

  const data    = sheet.getDataRange().getValues();
  const userSet = new Set();
  for (let i = 1; i < data.length; i++) {
    const hasPush = data[i][4] === true || String(data[i][4]).toUpperCase() === "TRUE";
    if (hasPush && data[i][0]) userSet.add(String(data[i][0]).trim());
  }

  const monthStr = Utilities.formatDate(today, "Asia/Taipei", "yyyy 年 MM 月");

  userSet.forEach(uid => {
    try {
      const flex = _buildMonthlyReportFlex(uid, monthStr);
      if (!flex) return;
      pushFlexToLine(uid, flex, `📅 ${monthStr} 月報`);
    } catch (e) { Logger.log(`月報 ${uid}: ${e.message}`); }
  });
}

function _buildMonthlyReportFlex(userId, monthStr) {
  const priceMap  = getCachedPriceMap();
  const portfolio = getUserPortfolio(userId);

  if (!portfolio.length) return null;

  let totalPnl = 0, totalCost = 0, bestStock = null, worstStock = null;

  const rows = portfolio.map(h => {
    const cur  = Number((priceMap[h.code] || {}).price) || h.costPrice;
    const pnl  = (cur - h.costPrice) * h.shares * 1000;
    const pct  = h.costPrice > 0 ? ((cur - h.costPrice) / h.costPrice) * 100 : 0;
    totalPnl  += pnl;
    totalCost += h.costPrice * h.shares * 1000;
    if (!bestStock  || pct > bestStock.pct)  bestStock  = { ...h, pct, cur };
    if (!worstStock || pct < worstStock.pct) worstStock = { ...h, pct, cur };
    const isUp = pnl >= 0;
    return _flexRow(`${h.name}(${h.code})`,
      `${isUp ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`,
      isUp ? "#EF4444" : "#10B981");
  });

  const isUp = totalPnl >= 0;
  const pct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: "#1E1B4B", contents: [
      { type: "text", text: `📅 ${monthStr} 月報`, weight: "bold", size: "md", color: "#A5B4FC" },
      { type: "text", text: "持倉帳面損益彙整", size: "xs", color: "#94A3B8", margin: "xs" }
    ]},
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      _sectionTitle("📊 整體損益"),
      _flexRow("帳面損益", `${isUp ? "+" : ""}${formatAmountUnit(totalPnl)}`, isUp ? "#EF4444" : "#10B981"),
      _flexRow("整體報酬率", `${isUp ? "+" : ""}${pct.toFixed(2)}%`, isUp ? "#EF4444" : "#10B981"),
      { type: "separator", margin: "md" },
      _sectionTitle("🏆 本月最強 / 最弱"),
      ...(bestStock  ? [_flexRow("🥇 最強", `${bestStock.name} +${bestStock.pct.toFixed(2)}%`, "#EF4444")] : []),
      ...(worstStock ? [_flexRow("📉 最弱", `${worstStock.name} ${worstStock.pct.toFixed(2)}%`, "#10B981")] : []),
      { type: "separator", margin: "md" },
      _sectionTitle("各持倉報酬率"),
      ...rows
    ]}
  };
}