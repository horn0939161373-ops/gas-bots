// ============================================================
// dump-districts.js ─ 從 591 傾印各縣市的行政區(section)代碼表
// ============================================================
//
// 用途：維護 gas/Code.gs 的 DISTRICTS_BY_REGION 與 src/config.js 的
// SECTION_MAP 時，用這支從 591 抓「目前實際有效」的行政區代碼，
// 不用手動一個一個從網址列抄。
//
// 執行（在 GitHub Actions 上跑 .github/workflows/dump-districts.yml，
// 本機有裝 Playwright 也可以直接跑）：
//   node scripts/dump-districts.js            # 預設抓六都
//   node scripts/dump-districts.js 1,3,17     # 指定 region 代碼
//
// 資料來源：591 列表頁的 __NUXT__ 前端狀態裡有整份「縣市→行政區」
// 選單設定（含名稱與 section 代碼），比爬 DOM 下拉選單穩定。

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 預設抓六都：台北1 新北3 桃園6 台中8 台南15 高雄17
const DEFAULT_REGIONS = ['1', '3', '6', '8', '15', '17'];

async function dumpRegion(page, region) {
  await page.goto(`https://rent.591.com.tw/list?region=${region}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  return page.evaluate((regionCode) => {
    // 在 __NUXT__ 裡找行政區選單：元素同時具備「以區/鄉/鎮/市結尾的中文
    // 名稱」與「純數字代碼」的陣列。多個候選時取包含最多筆的那個（完整
    // 的行政區清單一定比側欄的熱門區塊長）。
    const nameKeys = ['name', 'label', 'title', 'text'];
    const codeKeys = ['id', 'value', 'code', 'section', 'sectionId', 'key'];
    const candidates = [];
    const seen = new WeakSet();
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o) && o.length >= 5 && o[0] && typeof o[0] === 'object') {
        const item = o[0];
        const nk = nameKeys.find(k => typeof item[k] === 'string' && /[區鄉鎮市]$/.test(item[k]));
        if (nk) {
          const ck = codeKeys.find(k => item[k] != null && /^\d+$/.test(String(item[k])));
          if (ck) {
            const list = o
              .filter(it => it && typeof it[nk] === 'string' && /[區鄉鎮市]$/.test(it[nk]) && /^\d+$/.test(String(it[ck])))
              .map(it => [it[nk], Number(it[ck])]);
            if (list.length >= 5) candidates.push(list);
          }
        }
      }
      for (const k of Object.keys(o)) {
        let v; try { v = o[k]; } catch (e) { return; }
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    }
    try { walk(window.__NUXT__, 0); } catch (e) { /* ignore */ }
    if (!candidates.length) return { region: regionCode, error: '在 __NUXT__ 找不到行政區清單', districts: [] };
    candidates.sort((a, b) => b.length - a.length);
    // 同名去重（不同候選可能重疊）
    const best = candidates[0];
    const dedup = [];
    const used = new Set();
    for (const [n, c] of best) {
      if (!used.has(n)) { used.add(n); dedup.push([n, c]); }
    }
    return { region: regionCode, districts: dedup };
  }, region);
}

(async () => {
  const regions = (process.argv[2] ? process.argv[2].split(',') : DEFAULT_REGIONS).map(s => s.trim()).filter(Boolean);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ userAgent: UA });
  const out = {};
  for (const region of regions) {
    let result = { error: '未執行' };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await dumpRegion(page, region);
        if (result.districts && result.districts.length) break;
      } catch (e) {
        result = { region, error: e.message, districts: [] };
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    out[region] = result;
    console.log(`region=${region} → ${result.districts ? result.districts.length : 0} 個行政區${result.error ? `（${result.error}）` : ''}`);
  }
  await browser.close();
  console.log('=== DISTRICTS_JSON_BEGIN ===');
  console.log(JSON.stringify(out));
  console.log('=== DISTRICTS_JSON_END ===');
})();
