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

async function scrapeListings(filter) {
  const url = buildListUrl(filter);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // 讓頁面 JS 有時間解密並渲染列表
    return await extractListings(page);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeListings, buildListUrl };
