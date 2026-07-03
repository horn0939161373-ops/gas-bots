// ============================================================
// index.js ─ 入口：抓米可手機館報價、更新選取網頁用的資料、比對關注清單、推播 LINE
// ============================================================

const fs = require('fs');
const path = require('path');
const { scrapePhones } = require('./scrape');
const { pushPriceUpdates } = require('./line');
const { loadPriceMap, savePriceMap } = require('./state');
const { loadWatchlist, matchWatchlist } = require('./watchlist');

const WATCHLIST_PATH = path.join(__dirname, '..', 'watchlist.json');
const STATE_PATH = path.join(__dirname, '..', 'state', 'last-prices.json');
// docs/phones.json 放在 repo 根目錄的 docs/ 底下，讓 GitHub Pages 選手機的
// 網頁（docs/index.html）可以直接抓到最新報價資料。
const DATA_PATH = path.join(__dirname, '..', '..', 'docs', 'phones.json');

async function main() {
  console.log('=== 米可手機館報價 Bot ===');

  const phones = await scrapePhones();
  console.log(`抓到 ${phones.length} 支手機報價`);

  fs.writeFileSync(DATA_PATH, JSON.stringify(phones, null, 2) + '\n');
  console.log(`已更新選手機網頁用的資料：${DATA_PATH}`);

  const watchlist = loadWatchlist(WATCHLIST_PATH);
  console.log('關注清單 (watchlist.json):', watchlist);

  if (!watchlist.length) {
    console.log('關注清單是空的，只更新報價資料，不推播。到選手機網頁勾選想關注的機型，並把產生的內容貼進 watchlist.json。');
    return;
  }

  const matched = matchWatchlist(phones, watchlist);
  console.log(`關注清單命中 ${matched.length} 支手機`);

  const priceMap = loadPriceMap(STATE_PATH);
  const changes = [];
  for (const p of matched) {
    const prev = priceMap[p.id];
    if (prev === undefined) {
      changes.push({ ...p, isNew: true });
    } else if (prev !== p.price) {
      changes.push({ ...p, isNew: false, previousPrice: prev });
    }
  }

  if (!changes.length) {
    console.log('關注的手機報價都沒有變動，不推播。');
    return;
  }

  console.log(`發現 ${changes.length} 支手機報價異動（新上榜或改價），推播中...`);
  await pushPriceUpdates(changes);
  console.log('✅ 推播完成');

  for (const c of changes) priceMap[c.id] = c.price;
  savePriceMap(STATE_PATH, priceMap);
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
