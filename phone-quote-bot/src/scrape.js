// ============================================================
// scrape.js ─ 用 Playwright 開真實瀏覽器抓米可手機館(miko3c.com)的空機報價
// ============================================================
//
// 實際核對過 https://www.miko3c.com/price/phone/ 渲染後的內容（透過
// GitHub Actions log 的除錯輸出，因為開發環境連不到 miko3c.com）：
// 這是一個「價格總覽」表格，欄位是 型號｜原廠建議售價｜米可破盤價｜優惠活動，
// 而且每一列**沒有連到商品詳情頁的連結**，沒辦法像 591 scraper 那樣用
// 連結網址當錨點。改成直接解析渲染完成頁面的 innerText：每個機型是
// 「標題行 → 原價數字 → 米可破盤價數字 → （可能有促銷文字）」的固定樣式，
// 例如：
//   Apple 蘋果 iPhone 17 Pro (256GB)
//   39,900
//   36,990
// 這個文字樣式比 CSS class／DOM 結構穩定得多（class 名稱容易隨改版變動），
// 所以直接用文字規則解析，不依賴任何 CSS selector。

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE_URL = 'https://www.miko3c.com';
const LIST_PATH = '/price/phone/';
const LIST_URL = `${BASE_URL}${LIST_PATH}`;

const PRICE_RE = /^\d{1,3}(,\d{3})+$|^\d{4,7}$/;
const PROMO_LEADING_EMOJI_RE = /^[🎁✅⭐🔥💥📌🈹]/u;
const PROMO_KEYWORD_RE = /加購|贈|價值|限量|折抵|滿額|加碼/;
const HEADER_NOISE = new Set(['型號', '原廠建議售價', '米可破盤價', '優惠活動']);

function isPrice(line) {
  return PRICE_RE.test(line);
}
function isPromo(line) {
  return PROMO_LEADING_EMOJI_RE.test(line) || PROMO_KEYWORD_RE.test(line);
}
function isNoise(line) {
  return HEADER_NOISE.has(line);
}

function slugify(title) {
  return title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/**
 * 解析渲染完成頁面的 innerText，找出「標題行 → 原價 → 米可破盤價」的固定樣式。
 * 每個候選標題後面最多往下看 8 行（中間允許夾雜促銷文字／表頭雜訊），
 * 找到連續兩個價格數字就算一筆資料；找不到就當作不是標題，跳過。
 */
function parsePhonesFromText(bodyText) {
  const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
  const startIdx = lines.lastIndexOf('優惠活動'); // 表頭最後一欄，跳過表頭之前的導覽列文字
  const dataLines = startIdx >= 0 ? lines.slice(startIdx + 1) : lines;

  const results = [];
  let i = 0;
  while (i < dataLines.length) {
    const line = dataLines[i];
    if (isPrice(line) || isPromo(line) || isNoise(line)) { i++; continue; }

    const title = line;
    let j = i + 1;
    const prices = [];
    while (j < dataLines.length && prices.length < 2 && j < i + 8) {
      const l = dataLines[j];
      if (isPrice(l)) { prices.push(Number(l.replace(/,/g, ''))); j++; }
      else if (isPromo(l) || isNoise(l)) { j++; }
      else break;
    }

    if (prices.length === 2) {
      const [msrp, price] = prices;
      results.push({ id: slugify(title), title, price, msrp, cover: '', url: LIST_URL });
      i = j;
      while (i < dataLines.length && isPromo(dataLines[i])) i++;
    } else {
      i++;
    }
  }
  return results;
}

async function extractPhones(page) {
  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ''));
  return parsePhonesFromText(bodyText);
}

/**
 * 抓不到任何手機時的除錯用資料：頁面標題、部分頁面文字、連結網址樣本，
 * 方便對照 Actions log 判斷是頁面結構真的變了、還是暫時性錯誤（被擋、
 * 還沒渲染完成等）。
 */
async function debugDump(page) {
  return page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText.slice(0, 2000) : '(無 body)';
    const title = document.title;
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return { title, bodyText, anchorCount: anchors.length };
  });
}

async function _fetchOnePage(browser, urlPage) {
  const page = await browser.newPage({ userAgent: UA });
  try {
    const response = await page.goto(urlPage, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // 讓頁面 JS 有時間渲染列表
    const items = await extractPhones(page);
    const statusCode = response ? response.status() : 0;
    const debug = items.length === 0 ? await debugDump(page) : null;
    return { items, statusCode, debug };
  } finally {
    await page.close();
  }
}

async function scrapePhones() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const { items, statusCode, debug } = await _fetchOnePage(browser, LIST_URL);

    if (items.length === 0) {
      console.log('--- 除錯資訊（抓到 0 支手機） ---');
      console.log('網址:', LIST_URL, '| HTTP 狀態碼:', statusCode);
      if (debug) {
        console.log('頁面標題:', debug.title);
        console.log('<a> 標籤總數:', debug.anchorCount);
        console.log('--- 頁面文字前 2000 字 ---');
        console.log(debug.bodyText);
      }
    } else {
      console.log(`抓到 ${items.length} 支手機報價`);
    }

    return items;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePhones, parsePhonesFromText };
