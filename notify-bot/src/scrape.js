// ============================================================
// scrape.js ─ 用 Playwright 開真實瀏覽器抓 591 租屋搜尋結果
// ============================================================
//
// 591 目前的搜尋 API 回應是 AES 加密過的（金鑰藏在會變動的前端
// JS 裡），並且會做瀏覽器指紋偵測，純 HTTP 請求已經無法穩定取得
// 資料。這裡改用真實的 headless Chromium 開啟搜尋頁面，等頁面自己
// 的 JS 完成解密渲染後，直接從渲染完的 DOM 讀取資料。

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function buildListUrl(filter) {
  const params = new URLSearchParams();
  if (filter.region) params.set('region', String(filter.region));
  if (filter.section) params.set('section', String(filter.section));
  if (filter.kind && filter.kind !== '0') params.set('kind', String(filter.kind));
  if (filter.priceMin || filter.priceMax) {
    params.set('rentprice', `${filter.priceMin || 0}_${filter.priceMax || 999999}`);
  }
  if (filter.keyword) params.set('keyword', filter.keyword);
  if (filter.facilities && filter.facilities.length) params.set('option', filter.facilities.join(','));
  return `https://rent.591.com.tw/list?${params.toString()}`;
}

/**
 * 從渲染完成的搜尋結果頁 DOM 擷取物件資料。用「連到物件詳情頁的連結」
 * 當錨點去找資料，而不是依賴特定 CSS class（class 名稱較容易隨改版
 * 變動，連結網址格式相對穩定）。
 * ⚠️ 這是依現有頁面結構的最佳猜測，第一次真的跑過後應該用
 * workflow_dispatch 手動觸發、對照 Actions log 微調。
 */
async function extractListings(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(\d{6,})(?:[/?]|$)/);
      if (!m) continue;
      const postId = m[1];
      if (seen.has(postId)) continue;

      let container = a.closest('li') || a.closest('article') || a.parentElement;
      let hops = 0;
      while (container && container.innerText.trim().length < 20 && hops < 4) {
        container = container.parentElement;
        hops++;
      }
      if (!container) continue;

      const text = container.innerText.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      const priceMatch = text.match(/([\d,]{3,})\s*元?\s*\/?\s*月?/);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

      const img = container.querySelector('img');
      const cover = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

      const titleEl = container.querySelector('h3, h4, [class*="title"]');
      const title = (titleEl ? titleEl.innerText : text.slice(0, 30)).trim();

      seen.add(postId);
      results.push({
        id: postId,
        title,
        price,
        cover,
        url: 'https://rent.591.com.tw/' + postId
      });
    }
    return results;
  });
}

/**
 * 591 的防護會不定期把某些 GitHub Actions 出口 IP 列入黑名單（實測發現
 * 同一個 workflow 不同次執行、拿到不同 IP 時，結果會在「完全被擋」跟
 * 「完全正常」之間切換）。單次執行內重試對同一個 runner IP 幫助有限，
 * 但仍用小重試 + 短延遲當作低成本的保險；真正的可靠性來自排程本身每
 * 30 分鐘會用全新的 runner／IP 再試一次。
 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3000;

async function _fetchOnce(url) {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage({ userAgent: UA });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // 讓頁面 JS 有時間解密並渲染列表
    const items = await extractListings(page);
    const statusCode = response ? response.status() : 0;

    if (items.length === 0) {
      // 除錯用：抓不到任何物件時，印出頁面狀態方便判斷是「被擋」還是「選取器沒對到」
      console.log('--- 除錯資訊（0 筆物件） ---');
      console.log('HTTP 狀態碼:', statusCode);
      console.log('頁面標題:', await page.title());
      const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : '(無 body)');
      console.log('頁面文字前 500 字:', bodyText);
      const anchorCount = await page.evaluate(() => document.querySelectorAll('a[href]').length);
      console.log('頁面上 <a> 標籤總數:', anchorCount);
    }

    return { items, statusCode };
  } finally {
    await browser.close();
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeListings(filter) {
  const url = buildListUrl(filter);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { items, statusCode } = await _fetchOnce(url);
    const blocked = statusCode >= 400;

    if (!blocked || items.length > 0) return items;

    if (attempt < MAX_ATTEMPTS) {
      console.log(`⚠️ 第 ${attempt} 次疑似被擋（狀態碼 ${statusCode}），${RETRY_DELAY_MS / 1000} 秒後重試...`);
      await _sleep(RETRY_DELAY_MS);
    } else {
      console.log(`⚠️ 重試 ${MAX_ATTEMPTS} 次後仍疑似被擋，本輪放棄，等下次排程（不同 runner IP）再試。`);
    }
  }

  return [];
}

module.exports = { scrapeListings, buildListUrl };
