// ============================================================
// scrape.js ─ 用 Playwright 開真實瀏覽器抓米可手機館(miko3c.com)的空機報價
// ============================================================
//
// ⚠️ 這是依網站一般常見結構（商品連結 + 價格文字）做的最佳猜測選取邏輯，
// 開發時因為連不到 miko3c.com（環境的對外網路政策擋掉了這個網域），
// 沒辦法實際打開頁面核對 DOM 結構。第一次真的跑過後，務必用
// workflow_dispatch 手動觸發一次、對照 Actions log 的除錯輸出微調
// extractPhones() 的選取邏輯（作法跟 notify-bot/src/scrape.js 處理 591 時
// 一樣）。

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE_URL = 'https://www.miko3c.com';
const LIST_PATH = '/price/phone/';
const MAX_PAGES = 15; // 保險上限，避免分頁參數猜錯導致無限重複抓同一頁

function buildListUrl(page) {
  return page <= 1 ? `${BASE_URL}${LIST_PATH}` : `${BASE_URL}${LIST_PATH}?page=${page}`;
}

/**
 * 從渲染完成的頁面 DOM 擷取手機報價資料。用「連到商品頁的連結」當錨點
 * 去找資料，而不是依賴特定 CSS class（class 名稱較容易隨改版變動，
 * 連結網址格式相對穩定）。
 */
async function extractPhones(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      // 商品詳情頁網址通常長得像 /products/xxx-xxx
      const m = href.match(/\/products\/([a-zA-Z0-9\-_]+)/);
      if (!m) continue;
      const slug = m[1];
      if (seen.has(slug)) continue;

      let container = a.closest('li') || a.closest('article') || a.closest('div[class*="card"]') || a.parentElement;
      let hops = 0;
      while (container && container.innerText.trim().length < 6 && hops < 4) {
        container = container.parentElement;
        hops++;
      }
      if (!container) continue;

      const text = container.innerText.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // 價格常見格式：NT$29,900、$29,900、29,900元
      const priceMatch = text.match(/(?:NT\$|NTD|\$)\s?([\d,]{3,7})|([\d,]{4,7})\s*元/);
      const priceStr = priceMatch ? (priceMatch[1] || priceMatch[2]) : '';
      const price = priceStr ? Number(priceStr.replace(/,/g, '')) : 0;
      if (!price) continue; // 沒抓到價格的通常是無關連結（分類頁、導覽列等），跳過

      const img = container.querySelector('img');
      const cover = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

      const titleEl = container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]');
      const title = (titleEl ? titleEl.innerText : text.slice(0, 40)).trim().replace(/\s+/g, ' ');

      const url = href.startsWith('http') ? href : new URL(href, location.origin).href;

      seen.add(slug);
      results.push({ id: slug, title, price, cover, url });
    }
    return results;
  });
}

async function _fetchOnePage(browser, urlPage) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    const response = await page.goto(urlPage, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // 讓頁面 JS 有時間渲染列表
    const items = await extractPhones(page);
    const statusCode = response ? response.status() : 0;
    return { items, statusCode };
  } finally {
    await page.close();
  }
}

/**
 * 依序抓分頁，直到某一頁沒有「新的」商品為止（代表已到最後一頁，或分頁
 * 參數其實無效、每頁內容都一樣）。
 */
async function scrapePhones() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const all = [];
  const seenIds = new Set();

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const url = buildListUrl(pageNum);
      const { items, statusCode } = await _fetchOnePage(browser, url);

      if (pageNum === 1 && items.length === 0) {
        console.log('--- 除錯資訊（第 1 頁抓到 0 支手機） ---');
        console.log('網址:', url, '| HTTP 狀態碼:', statusCode);
        console.log('可能是選取器跟目前頁面結構對不上，需要對照 Actions log 微調 extractPhones()。');
      }

      const newOnes = items.filter(i => !seenIds.has(i.id));
      if (newOnes.length === 0) {
        console.log(`第 ${pageNum} 頁沒有新商品，停止翻頁。`);
        break;
      }

      for (const item of newOnes) {
        seenIds.add(item.id);
        all.push(item);
      }
      console.log(`第 ${pageNum} 頁抓到 ${newOnes.length} 支新手機（累計 ${all.length} 支）`);
    }
  } finally {
    await browser.close();
  }

  return all;
}

module.exports = { scrapePhones, buildListUrl };
