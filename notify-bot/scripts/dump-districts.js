// ============================================================
// dump-districts.js ─ 從 591 傾印全台行政區(section)代碼表
// ============================================================
//
// 資料來源：591 列表頁載入的靜態設定 JS（s.591.com.tw/house/*.js）裡
// 有整份「縣市 id → 行政區 {id, name, lat, lng}」對照表，用回應攔截
// 拿到後直接正則擷取，不用點選單、不依賴 DOM 結構。
//
// 用途：維護 gas/Code.gs 的 DISTRICTS_BY_REGION 與 src/config.js 的
// SECTION_MAP。在 GitHub Actions 上跑（.github/workflows/dump-districts.yml），
// 結果印在 log 的 DISTRICTS_JSON_BEGIN/END 標記之間。

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let captured = null;

  // 591 會不定期封鎖部分 GitHub Actions 出口 IP（403），多試幾次
  for (let attempt = 1; attempt <= 6 && !captured; attempt++) {
    const page = await browser.newPage({ userAgent: UA });
    page.on('response', async (res) => {
      try {
        if (captured) return;
        const ct = res.headers()['content-type'] || '';
        if (!/javascript/.test(ct)) return;
        const text = await res.text().catch(() => '');
        if (!text || text.indexOf('中和區') < 0 || text.indexOf('child:[') < 0) return;
        captured = text;
        console.log('資料來源:', res.url());
      } catch (e) { /* ignore */ }
    });
    const resp = await page.goto('https://rent.591.com.tw/list?region=3', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(4000);
    console.log(`attempt=${attempt} status=${resp ? resp.status() : 0} captured=${!!captured}`);
    await page.close();
    if (!captured) await new Promise(r => setTimeout(r, 4000));
  }
  await browser.close();

  if (!captured) {
    console.log('!! 沒攔到含行政區設定的 JS（可能每次都被擋），重跑一次 workflow 換 IP 再試');
    process.exit(1);
  }

  // 擷取 {id:<region>,…child:[{id:<section>,name:"XX區",…}]} 結構
  const out = {};
  const regionRe = /\{id:(\d+),(?:name:"[^"]*",)?child:\[(.*?)\]\}/g;
  let m;
  while ((m = regionRe.exec(captured))) {
    const regionId = m[1];
    const items = [];
    const itemRe = /id:(\d+),name:"([^"]{1,8})"/g;
    let im;
    while ((im = itemRe.exec(m[2]))) {
      if (/[區鄉鎮市]$/.test(im[2])) items.push([im[2], Number(im[1])]);
    }
    if (items.length >= 3) out[regionId] = items;
  }

  const counts = Object.keys(out).map(k => `${k}:${out[k].length}`).join(' ');
  console.log('各縣市行政區數:', counts);
  console.log('=== DISTRICTS_JSON_BEGIN ===');
  console.log(JSON.stringify(out));
  console.log('=== DISTRICTS_JSON_END ===');
})();
