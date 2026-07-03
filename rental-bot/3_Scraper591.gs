// ============================================================
// 3_Scraper591.gs ─ 591 租屋網爬蟲核心
// ============================================================

const RENT_591_BASE     = "https://rent.591.com.tw";
const RENT_591_LIST_API = RENT_591_BASE + "/home/search/rsList";

const KIND_MAP = { "0": "不限", "1": "整層住家", "2": "獨立套房", "3": "分租套房", "4": "雅房", "5": "別墅" };

/**
 * 591 對搜尋 API 有 CSRF 驗證，需先造訪首頁取得 Set-Cookie 內的
 * T591_TOKEN，再原樣帶入後續請求的 Cookie 與 X-CSRF-TOKEN header。
 * 若 591 調整了驗證機制，這裡是唯一需要跟著調整的地方。
 */
function fetch591Session() {
  const res = UrlFetchApp.fetch(RENT_591_BASE + "/", {
    muteHttpExceptions: true,
    headers: { "User-Agent": _ua591() }
  });
  const rawCookies = res.getAllHeaders()["Set-Cookie"] || [];
  const cookieArr  = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
  const cookieStr  = cookieArr.map(c => c.split(";")[0]).join("; ");
  const tokenMatch = cookieStr.match(/T591_TOKEN=([^;]+)/);
  return { cookie: cookieStr, token: tokenMatch ? tokenMatch[1] : "" };
}

function _ua591() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
}

/**
 * 依篩選條件呼叫 591 搜尋 API，回傳整理過的物件清單（新到舊排序）。
 * filter: { region, priceMin, priceMax, kind, keyword, facilities }
 */
function fetchListings591(filter, firstRow) {
  const session = fetch591Session();
  const params = {
    is_new_list: "1",
    type: "1",
    region: String(filter.region || ""),
    firstRow: String(firstRow || 0),
    order: "posttime",
    orderType: "desc"
  };
  if (filter.priceMin || filter.priceMax) {
    params.rentprice = `${filter.priceMin || 0}_${filter.priceMax || 999999}`;
  }
  if (filter.kind && filter.kind !== "0") params.kind = filter.kind;
  if (filter.keyword) params.keyword = filter.keyword;
  if (filter.facilities && filter.facilities.length) params.option = filter.facilities.join(",");

  const query = Object.keys(params)
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");

  const res = UrlFetchApp.fetch(`${RENT_591_LIST_API}?${query}`, {
    muteHttpExceptions: true,
    headers: {
      "User-Agent": _ua591(),
      "Referer": RENT_591_BASE + "/",
      "X-CSRF-TOKEN": session.token,
      "Cookie": session.cookie,
      "Accept": "application/json"
    }
  });

  if (res.getResponseCode() !== 200) {
    Logger.log("❌ 591 API 回應失敗: " + res.getResponseCode() + " " + res.getContentText().substring(0, 200));
    return [];
  }

  let json;
  try { json = JSON.parse(res.getContentText()); } catch (e) {
    Logger.log("❌ 591 回應非 JSON: " + e.message);
    return [];
  }

  const items = (json && json.data && json.data.data) || [];
  return items.map(_normalizeListing591).filter(Boolean);
}

function _normalizeListing591(raw) {
  if (!raw || !raw.post_id) return null;
  return {
    id: String(raw.post_id),
    title: raw.title || "未命名物件",
    price: Number(raw.price) || 0,
    priceUnit: raw.price_unit || "元/月",
    kind: KIND_MAP[String(raw.kind)] || "",
    area: raw.area || "",
    floor: raw.floor_str || raw.floor || "",
    region: raw.section_name || raw.region_name || "",
    address: raw.address || "",
    cover: raw.cover ? (String(raw.cover).startsWith("http") ? raw.cover : "https:" + raw.cover) : "",
    url: `https://rent.591.com.tw/${raw.post_id}`
  };
}
