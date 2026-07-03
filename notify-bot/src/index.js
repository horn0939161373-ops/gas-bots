// ============================================================
// index.js ─ 入口：抓 591 新物件、跟已推播紀錄比對、推播 LINE
// ============================================================

const fs = require('fs');
const path = require('path');
const { scrapeListings } = require('./scrape');
const { pushNewListings } = require('./line');
const { loadSeenIds, saveSeenIds } = require('./state');
const { resolveConfig } = require('./config');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state', 'seen-listings.json');

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
