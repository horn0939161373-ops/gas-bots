// ============================================================
// 5_NotifyService.gs ─ 定時比對新物件並推播
// ============================================================

const SEEN_SHEET          = "SeenListings";
const SEEN_HEADERS        = ["userId", "postId", "seenAt"];
const SEEN_RETENTION_DAYS = 14;

/** 供 GAS 時間觸發器呼叫：查詢所有已開啟通知的使用者，推播新物件 */
function triggerRentalCheck() {
  const filters = getAllEnabledFilters();
  if (!filters.length) return;

  const seenSheet = getOrCreateSheet(SEEN_SHEET, SEEN_HEADERS);
  const seenData  = seenSheet.getDataRange().getValues();
  const seenSet   = {}; // userId -> { postId: true }
  for (let i = 1; i < seenData.length; i++) {
    const uid = String(seenData[i][0]).trim();
    const pid = String(seenData[i][1]).trim();
    if (!seenSet[uid]) seenSet[uid] = {};
    seenSet[uid][pid] = true;
  }

  const newRows = [];

  filters.forEach(f => {
    let listings;
    try {
      listings = fetchListings591(f);
    } catch (e) {
      Logger.log(`❌ ${f.userId} 查詢失敗: ${e.message}`);
      return;
    }

    const userSeen = seenSet[f.userId] || {};
    const fresh = listings.filter(l => !userSeen[l.id]).slice(0, 10);
    if (!fresh.length) return;

    const bubbles = fresh.map(FlexMessage.buildListingBubble);
    const res = pushFlexToLine(f.userId, { type: "carousel", contents: bubbles }, `🏠 找到 ${fresh.length} 筆新物件！`);
    Logger.log(`${res.getResponseCode() === 200 ? "✅" : "❌"} 591 通知 → ${f.userId}`);

    if (res.getResponseCode() === 200) {
      fresh.forEach(l => newRows.push([f.userId, l.id, nowTimestamp()]));
    }
  });

  if (newRows.length) {
    seenSheet.getRange(seenSheet.getLastRow() + 1, 1, newRows.length, SEEN_HEADERS.length).setValues(newRows);
  }
}

/** 清理超過保留天數的已讀紀錄，避免 SeenListings 無限增長；建議每日定時觸發一次 */
function cleanupOldSeenListings() {
  const sheet = getOrCreateSheet(SEEN_SHEET, SEEN_HEADERS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const cutoff   = new Date(Date.now() - SEEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keepRows = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const ts = new Date(data[i][2]);
    if (isNaN(ts) || ts >= cutoff) keepRows.push(data[i]);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, keepRows.length, SEEN_HEADERS.length).setValues(keepRows);
}

function testForceRentalCheck() {
  Logger.log("=== 🚀 強制查詢測試 ===");
  triggerRentalCheck();
}

/**
 * 診斷用：測試 GAS 能否連上爬蟲服務（Cloud Run）並取得 591 資料，
 * 不需要任何使用者訂閱資料。在 Apps Script 編輯器選這個函式執行，
 * 看「執行紀錄」的結果即可。
 */
function testScraperService() {
  Logger.log("=== 呼叫爬蟲服務（region=1 台北市）===");
  let listings;
  try {
    listings = fetchListings591({ region: "1" });
  } catch (e) {
    Logger.log("❌ 呼叫失敗: " + e.message + "（請確認 Script Properties 的 SCRAPER_SERVICE_URL / SCRAPER_SERVICE_SECRET 是否已設定）");
    return;
  }
  Logger.log("取得物件筆數: " + listings.length);
  if (listings.length) {
    Logger.log("第一筆範例: " + JSON.stringify(listings[0]));
  } else {
    Logger.log("❌ 沒有取得任何物件，請檢查上方 Logger 輸出的錯誤訊息，或用瀏覽器打開爬蟲服務的 /debug?region=1 端點對照實際頁面結構。");
  }
}
