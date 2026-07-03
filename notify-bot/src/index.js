// ============================================================
// index.js ─ 入口：抓 591 新物件、跟已推播紀錄比對、推播 LINE
// ============================================================

const fs = require('fs');
const path = require('path');
const { scrapeListings } = require('./scrape');
const { pushNewListings } = require('./line');
const { loadSeenIds, saveSeenIds, loadListingsData, saveListingsData } = require('./state');
const { resolveConfig } = require('./config');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state', 'seen-listings.json');
const LISTINGS_DATA_PATH = path.join(__dirname, '..', 'state', 'listings-data.json');

async function main() {
  const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const filter = resolveConfig(rawConfig);
  console.log('=== 591 租屋通知 ===');
  console.log('篩選條件 (config.json):', rawConfig);
  console.log('轉換後查詢條件:', filter);

  const listings = await scrapeListings(filter);
  console.log(`抓到 ${listings.length} 筆物件`);

  // 把這次抓到的完整資料（標題/價格/圖片/連結）保留下來，不是只記 id，
  // 之後想回顧「之前到底抓到了什麼」才查得到。
  const existingData = loadListingsData(LISTINGS_DATA_PATH);
  saveListingsData(LISTINGS_DATA_PATH, listings, existingData);

  const seenIds = loadSeenIds(STATE_PATH);
  const seenSet = new Set(seenIds);
  const fresh = listings.filter(l => !seenSet.has(l.id));

  if (!fresh.length) {
    console.log('沒有新物件，結束。');
    return;
  }

  console.log(`發現 ${fresh.length} 筆新物件，推播中...`);
  await pushNewListings(fresh);
  console.log('✅ 推播完成');

  saveSeenIds(STATE_PATH, [...seenIds, ...fresh.map(l => l.id)]);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
