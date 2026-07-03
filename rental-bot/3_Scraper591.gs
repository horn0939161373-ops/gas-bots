// ============================================================
// 3_Scraper591.gs ─ 呼叫 591 爬蟲服務（Cloud Run + Playwright）
// ============================================================
//
// 591 目前的搜尋 API 回應是 AES 加密過的（金鑰藏在會變動的前端
// JS 裡），並且會做瀏覽器指紋偵測，純 HTTP 請求已經無法穩定取得
// 資料。因此改為呼叫獨立部署的 Playwright 爬蟲服務（見專案根目錄
// /scraper-service，部署在 Cloud Run），由它用真實瀏覽器渲染頁面
// 後回傳解析好的物件清單，這裡只負責打這支內部 API。

const KIND_MAP = { "0": "不限", "1": "整層住家", "2": "獨立套房", "3": "分租套房", "4": "雅房", "5": "別墅" };

function getScraperServiceUrl() {
  const url = PropertiesService.getScriptProperties().getProperty('SCRAPER_SERVICE_URL');
  if (!url) throw new Error('尚未設定 Script Properties 的 SCRAPER_SERVICE_URL');
  return url.replace(/\/$/, '');
}
function getScraperServiceSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('SCRAPER_SERVICE_SECRET');
  if (!secret) throw new Error('尚未設定 Script Properties 的 SCRAPER_SERVICE_SECRET');
  return secret;
}

/**
 * 呼叫爬蟲服務取得符合篩選條件的物件清單（新到舊排序，由 591 頁面本身排序決定）。
 * filter: { region, priceMin, priceMax, kind, keyword, facilities }
 */
function fetchListings591(filter) {
  const res = UrlFetchApp.fetch(getScraperServiceUrl() + '/search', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-scraper-secret': getScraperServiceSecret() },
    payload: JSON.stringify({
      region: filter.region || '',
      priceMin: filter.priceMin || 0,
      priceMax: filter.priceMax || 0,
      kind: filter.kind || '0',
      keyword: filter.keyword || '',
      facilities: filter.facilities || []
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log("❌ 爬蟲服務回應失敗: " + res.getResponseCode() + " " + res.getContentText().substring(0, 300));
    return [];
  }

  let json;
  try { json = JSON.parse(res.getContentText()); } catch (e) {
    Logger.log("❌ 爬蟲服務回應非 JSON: " + e.message);
    return [];
  }

  if (!json.ok) {
    Logger.log("❌ 爬蟲服務錯誤: " + json.error);
    return [];
  }

  return (json.items || []).map(_normalizeListing591).filter(Boolean);
}

function _normalizeListing591(raw) {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    title: raw.title || "未命名物件",
    price: Number(raw.price) || 0,
    priceUnit: "元/月",
    kind: "",
    area: "",
    floor: "",
    region: "",
    address: "",
    cover: raw.cover || "",
    url: raw.url || `https://rent.591.com.tw/${raw.id}`
  };
}
