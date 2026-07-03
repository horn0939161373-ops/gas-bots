// ============================================================
// index.js ─ 入口：抓 591 新物件、跟已推播紀錄比對、推播 LINE
// ============================================================

const fs = require('fs');
const path = require('path');
const { scrapeListings } = require('./scrape');
const { pushNewListings } = require('./line');
const { loadSeenIds, saveSeenIds, loadListingsData, saveListingsData } = require('./state');
const { resolveConfig } = require('./config');
const { geocodeAndMeasure } = require('./geocode');
const { buildDashboardHtml } = require('./dashboard');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state', 'seen-listings.json');
const LISTINGS_DATA_PATH = path.join(__dirname, '..', 'state', 'listings-data.json');
const GEOCODE_CACHE_PATH = path.join(__dirname, '..', 'state', 'geocode-cache.json');
const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.html');

function loadGeocodeCache() {
  try {
    return JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveGeocodeCache(cache) {
  fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

async function main() {
  const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const filter = resolveConfig(rawConfig);
  console.log('=== 591 租屋通知 ===');
  console.log('篩選條件 (config.json):', rawConfig);
  console.log('轉換後查詢條件:', filter);

  const listings = await scrapeListings(filter);
  console.log(`抓到 ${listings.length} 筆物件`);

  const seenIds = loadSeenIds(STATE_PATH);
  const seenSet = new Set(seenIds);
  let fresh = listings.filter(l => !seenSet.has(l.id));

  // 一定要把快取檔寫回磁碟（就算這次沒有新物件、沒有查地理編碼），確保
  // 這個檔案一定存在，讓 workflow 最後的 git add 不會因為檔案還沒建立
  // 過而失敗（實測第一次執行就發生過這個問題：0 筆新物件時完全不會走
  // 到距離篩選的程式碼，state/geocode-cache.json 從頭到尾沒被建立過，
  // git add 對不存在的路徑會直接報錯讓整個 commit 步驟失敗）。
  const geocodeCache = loadGeocodeCache();

  // 距離篩選：只對「新物件」查地理編碼（已經看過的物件不用重查），太遠
  // 的直接排除不推播。地址查不到座標、或本來就沒開啟這個功能時，維持
  // 原本的行為照樣推播，不會因為地理編碼服務一時查不到就漏掉真正的新
  // 物件。
  if (fresh.length && filter.distanceFilter.enabled) {
    console.log(`距離篩選啟用中，查詢跟「${filter.distanceFilter.landmarkName}」的距離（上限 ${filter.distanceFilter.maxDistanceKm} 公里）...`);
    const landmark = { lat: filter.distanceFilter.landmarkLat, lon: filter.distanceFilter.landmarkLng };
    const distanceById = await geocodeAndMeasure(fresh, landmark, geocodeCache);

    for (const item of fresh) {
      const result = distanceById.get(item.id);
      item.distanceKm = result ? Number(result.distanceKm.toFixed(2)) : null;
    }

    const tooFar = fresh.filter(item => item.distanceKm != null && item.distanceKm > filter.distanceFilter.maxDistanceKm);
    if (tooFar.length) {
      console.log(`${tooFar.length} 筆新物件距離超過門檻，不推播：${tooFar.map(i => `${i.id}(${i.distanceKm}km)`).join(', ')}`);
    }
    fresh = fresh.filter(item => !(item.distanceKm != null && item.distanceKm > filter.distanceFilter.maxDistanceKm));
  }

  saveGeocodeCache(geocodeCache);

  // 把這次抓到的完整資料（標題/價格/圖片/連結/地址/距離）保留下來，不是
  // 只記 id，之後想回顧「之前到底抓到了什麼」才查得到，後台視覺化頁面
  // 也是從這份資料產生的。
  const existingData = loadListingsData(LISTINGS_DATA_PATH);
  const dashboardData = saveListingsData(LISTINGS_DATA_PATH, listings, existingData);

  // 每次執行都重新產生一份自包含的視覺化頁面（資料直接嵌在 HTML 裡），
  // 不管這次有沒有新物件，都要能看到目前保留下來的完整抓取紀錄。
  const dashboardHtml = buildDashboardHtml(dashboardData, {
    generatedAt: new Date().toISOString(),
    landmarkName: filter.distanceFilter.enabled ? filter.distanceFilter.landmarkName : '',
    maxDistanceKm: filter.distanceFilter.maxDistanceKm
  });
  fs.writeFileSync(DASHBOARD_PATH, dashboardHtml);
  console.log(`📊 已產生視覺化頁面：${DASHBOARD_PATH}`);

  if (!fresh.length) {
    console.log('沒有新物件（或都被距離篩選排除），結束。');
    // 不管有沒有推播，只要有掃過的物件就把它們標記成已讀，避免下次又
    // 重新查一次地理編碼、又判斷一次太遠。
    if (listings.length) {
      const scannedIds = listings.filter(l => !seenSet.has(l.id)).map(l => l.id);
      if (scannedIds.length) saveSeenIds(STATE_PATH, [...seenIds, ...scannedIds]);
    }
    return;
  }

  console.log(`發現 ${fresh.length} 筆新物件，推播中...`);
  await pushNewListings(fresh);
  console.log('✅ 推播完成');

  // 把「這次掃過的所有新物件」都標記成已讀，包含被距離篩選排除的，避免
  // 下次又重新查一次地理編碼、又判斷一次太遠。
  const scannedIds = listings.filter(l => !seenSet.has(l.id)).map(l => l.id);
  saveSeenIds(STATE_PATH, [...seenIds, ...scannedIds]);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
