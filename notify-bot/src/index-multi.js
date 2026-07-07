// ============================================================
// index-multi.js ─ 多人版入口：每個使用者依自己的條件收到自己的推播
// ============================================================
//
// 流程：載入所有訂閱 → 把「相同搜尋條件」的人分組（同條件只抓一次）→
// 每組抓一次最新物件 → 對組內每個人，比對他自己的已推紀錄，找出他的新
// 物件 → 推到他自己的 LINE → 回寫他自己的已推紀錄。

const path = require('path');
const { scrapeListings } = require('./scrape');
const { pushListingsToTarget } = require('./line');
const { loadSubscriptions, groupByFilter } = require('./subscriptions');
const { loadListingsData, saveListingsData, loadSubscriberSeen, saveSubscriberSeen } = require('./state');

const LISTINGS_DATA_PATH = path.join(__dirname, '..', 'state', 'listings-data.json');
const SUBSCRIBER_SEEN_PATH = path.join(__dirname, '..', 'state', 'subscribers-seen.json');

async function main() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('尚未設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數');

  const subscriptions = await loadSubscriptions();
  console.log('=== 591 租屋通知（多人版）===');
  console.log(`載入 ${subscriptions.length} 筆訂閱`);
  if (!subscriptions.length) {
    console.log('沒有任何訂閱，結束。');
    return;
  }

  const groups = groupByFilter(subscriptions);
  console.log(`歸併成 ${groups.length} 組不同搜尋條件（同條件只抓一次）`);

  let listingsData = loadListingsData(LISTINGS_DATA_PATH);
  const seenByUser = loadSubscriberSeen(SUBSCRIBER_SEEN_PATH);
  let anyDataChanged = false;

  for (const group of groups) {
    let listings = [];
    try {
      listings = await scrapeListings(group.filter);
    } catch (e) {
      console.error('抓取失敗，跳過這組條件:', e.message);
      continue;
    }
    console.log(`條件 ${group.key} → 抓到 ${listings.length} 筆，涵蓋 ${group.subs.length} 位訂閱者`);
    if (!listings.length) continue;

    // 保留完整物件資料（共用一份，跟單人版一樣）。要接回傳值當下一組的
    // 基底，不然多組條件時後面那組會把前面剛存的物件洗掉。
    listingsData = saveListingsData(LISTINGS_DATA_PATH, listings, listingsData);
    anyDataChanged = true;

    for (const sub of group.subs) {
      // 同組共用抓取時取的是「組內最大」的 maxResults，這裡要切回這個
      // 訂閱者自己要的筆數（listings 已是新到舊排序，取前 N 即最新 N 筆）。
      const subMax = Number(sub.maxResults) > 0 ? Number(sub.maxResults) : 10;
      // 用 subKey（subId）當去重身分，這樣同一個人的多組不同條件各自獨立，
      // 不會因為某組推過某物件、害另一組也不推。
      const seen = new Set(seenByUser[sub.subKey] || []);
      const fresh = listings.slice(0, subMax).filter(l => !seen.has(l.id));
      if (!fresh.length) {
        console.log(`  - ${sub.userId}(${sub.subKey})：沒有新物件`);
        continue;
      }
      try {
        await pushListingsToTarget(token, sub.userId, fresh);
        // 推播成功才記入已推紀錄（推失敗就下輪再試，不會漏）
        seenByUser[sub.subKey] = [...(seenByUser[sub.subKey] || []), ...fresh.map(l => l.id)];
        anyDataChanged = true;
        console.log(`  - ${sub.userId}(${sub.subKey})：推播 ${fresh.length} 筆 ✅`);
      } catch (e) {
        console.error(`  - ${sub.userId}(${sub.subKey})：推播失敗（下輪重試）:`, e.message);
      }
    }
  }

  if (anyDataChanged) {
    saveSubscriberSeen(SUBSCRIBER_SEEN_PATH, seenByUser);
  }
  console.log('✅ 本輪結束');
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
