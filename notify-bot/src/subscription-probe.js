// ============================================================
// subscription-probe.js ─ 驗證「帶 Cookie 登入讀 591 訂閱頁」可不可行
// ============================================================
//
// 這支只做「探測」：帶著存在 GitHub Secret（RENT591_COOKIE）裡的 Cookie，
// 打開你提供的訂閱頁網址（SUBSCRIPTION_URL），印出並把結果寫成
// state/subscription-probe.json，方便回頭判斷：
//   1. Cookie 有沒有讓我們真的以「已登入」狀態看到頁面
//   2. 這個頁面上抓不抓得到物件卡片
// 它「不會」推播 LINE、也「不會」動到 seen-listings。純唯讀探針。

const fs = require('fs');
const path = require('path');
const { probeSubscription } = require('./scrape');

const OUT_PATH = path.join(__dirname, '..', 'state', 'subscription-probe.json');

async function main() {
  const url = process.env.SUBSCRIPTION_URL;
  const cookie = process.env.RENT591_COOKIE;

  if (!url) {
    throw new Error('缺少 SUBSCRIPTION_URL（請在 Actions 的 Run workflow 表單裡填入你的訂閱頁網址）');
  }
  console.log('=== 591 訂閱探測 ===');
  console.log('目標網址:', url);
  console.log('是否帶 Cookie:', cookie ? `是（長度 ${cookie.length}）` : '否（未設定 RENT591_COOKIE Secret）');

  const r = await probeSubscription(url, cookie);

  const summary = {
    probedAt: new Date().toISOString(),
    statusCode: r.statusCode,
    cookiesInjected: r.cookiesInjected,
    meta: r.meta,
    itemCount: r.items.length,
    sampleItems: r.items.slice(0, 10).map(it => ({
      id: it.id,
      title: it.title,
      price: it.price,
      cover: it.cover ? 'ok' : 'empty',
      url: it.url
    }))
  };

  console.log('--- 探測結果 ---');
  console.log(JSON.stringify(summary, null, 2));

  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log('已寫入', OUT_PATH);
}

main().catch(err => {
  console.error('❌ 探測失敗:', err);
  process.exit(1);
});
