// ============================================================
// index.js ─ 591 租屋搜尋爬蟲服務（Playwright + Express）
// ============================================================
//
// 591 現在的搜尋 API 回應是 AES 加密過的（金鑰藏在會變動的前端 JS
// 裡），而且會偵測瀏覽器指紋，純 HTTP 請求已經無法穩定取得資料。
// 這個服務改用真實的 headless Chromium 開啟搜尋頁面，等頁面自己的
// JS 完成解密渲染後，直接從渲染完的 DOM 讀取資料——不去碰加密細節。
//
// GAS 端（rental-bot/3_Scraper591.gs）呼叫這個服務的 /search，
// 取得整理好的物件清單。

const express = require('express');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8080;
const SCRAPER_SECRET = process.env.SCRAPER_SECRET || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const app = express();
app.use(express.json());

// ─── 共用瀏覽器實例（同一個 Cloud Run instance 內重複使用，避免每次都要重啟瀏覽器） ─
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
      .catch(err => { browserPromise = null; throw err; });
  }
  return browserPromise;
}

// ─── 驗證：只有帶正確 secret header 的請求才處理，避免服務被公開濫用 ─
function requireSecret(req, res, next) {
  if (!SCRAPER_SECRET) {
    res.status(500).json({ ok: false, error: 'SCRAPER_SECRET 尚未設定，服務拒絕處理請求' });
    return;
  }
  if (req.get('x-scraper-secret') !== SCRAPER_SECRET) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}

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
 * 從渲染完成的搜尋結果頁 DOM 擷取物件資料。
 * 用「連到物件詳情頁的連結」當錨點去找資料，而不是依賴特定 CSS
 * class（class 名稱較容易隨改版變動，連結網址格式相對穩定）。
 * ⚠️ 這是依現有頁面結構的最佳猜測，第一次真的部署後應該用
 * GET /debug 對照實際 HTML 微調。
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
        rawText: text.slice(0, 200),
        cover,
        url: 'https://rent.591.com.tw/' + postId
      });
    }
    return results;
  });
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/search', requireSecret, async (req, res) => {
  const filter = req.body || {};
  const url = buildListUrl(filter);
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // 讓頁面 JS 有時間解密並渲染列表
    const items = await extractListings(page);
    res.json({ ok: true, url, count: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, url, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

/** 除錯用：回傳頁面標題與部分 HTML，方便對照實際結構調整 extractListings 的選取邏輯 */
app.get('/debug', requireSecret, async (req, res) => {
  const filter = {
    region: req.query.region || '1',
    kind: req.query.kind || '',
    keyword: req.query.keyword || ''
  };
  const url = buildListUrl(filter);
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const pageTitle = await page.title();
    const bodyHtmlSnippet = (await page.content()).slice(0, 8000);
    res.json({ ok: true, url, pageTitle, bodyHtmlSnippet });
  } catch (err) {
    res.status(500).json({ ok: false, url, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`591 scraper service listening on :${PORT}`);
});
