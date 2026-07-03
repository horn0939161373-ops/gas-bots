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
 *
 * 591 同一筆物件在卡片裡常常有「不只一個」連到詳情頁的 <a>（例如縮圖
 * 一個、標題文字又一個，分屬不同的子區塊），單純從其中一個 <a> 往上爬
 * 幾層找容器，容易只爬到「標題」這種小區塊就因為文字夠長而提早停止，
 * 抓不到跟它同層、放價格跟圖片的其他區塊（實測發現這是大部分物件推播
 * 出來標題正確、但價格 $0、沒有圖片的根本原因）。
 * 改成：先收集同一個物件 id 的「所有」連結，取它們的最近共同祖先當
 * 容器起點，再視需要往上爬，直到容器內同時找得到價格跟圖片為止，且
 * 途中一旦發現爬過頭、容器已經包含別筆物件的連結，就停止（避免把兩筆
 * 物件的資料混在一起）。
 */
async function extractListings(page) {
  return page.evaluate(() => {
    const idToAnchors = new Map();
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(\d{6,})(?:[/?]|$)/);
      if (!m) continue;
      const postId = m[1];
      if (!idToAnchors.has(postId)) idToAnchors.set(postId, []);
      idToAnchors.get(postId).push(a);
    }

    function commonAncestor(nodes) {
      let ancestor = nodes[0];
      for (let i = 1; i < nodes.length; i++) {
        while (ancestor && !ancestor.contains(nodes[i])) {
          ancestor = ancestor.parentElement;
        }
      }
      return ancestor;
    }

    function containsOtherListing(el, postId) {
      const as = el.querySelectorAll('a[href]');
      for (const a2 of as) {
        const href2 = a2.getAttribute('href') || '';
        const m2 = href2.match(/\/(\d{6,})(?:[/?]|$)/);
        if (m2 && m2[1] !== postId) return true;
      }
      return false;
    }

    // 圖片網址擷取：591 用懶載入，src 常常是 data: URI 佔位圖，真正的網址
    // 在 data-src 等屬性；佔位圖雖然是非空字串，但不能當成「已經抓到」。
    function pickImageUrl(img) {
      if (!img) return '';
      const candidates = [
        img.getAttribute('src'),
        img.getAttribute('data-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazy-src')
      ];
      for (const c of candidates) {
        if (c && !c.startsWith('data:')) return c;
      }
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (srcset) {
        const first = srcset.split(',')[0].trim().split(' ')[0];
        if (first && !first.startsWith('data:')) return first;
      }
      return '';
    }

    const results = [];
    for (const [postId, anchorList] of idToAnchors) {
      let container = commonAncestor(anchorList);
      if (!container) continue;

      let hops = 0;
      while (hops < 6) {
        const hasPrice = !!container.querySelector('[class*="price" i]');
        const hasImg = !!container.querySelector('img');
        if (hasPrice && hasImg) break;
        const parent = container.parentElement;
        if (!parent || containsOtherListing(parent, postId)) break;
        container = parent;
        hops++;
      }

      const text = container.innerText.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // 價格：優先找 class 帶 price 的元素縮小範圍，且一定要求數字後面緊接
      // 「元」，避免抓到坪數、樓層、瀏覽次數等卡片上其他跟價格無關的數字
      // （這個問題造成過推播出來的租金是錯的）。
      const priceEl = container.querySelector('[class*="price" i]');
      const priceSource = priceEl ? priceEl.innerText : text;
      const priceMatch = priceSource.match(/([\d,]{3,})\s*元/);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

      const img = container.querySelector('img');
      const cover = pickImageUrl(img);

      const titleEl = container.querySelector('h3, h4, [class*="title"]');
      const title = (titleEl ? titleEl.innerText : text.slice(0, 30)).trim();

      results.push({
        id: postId,
        title,
        price,
        cover,
        url: 'https://rent.591.com.tw/' + postId,
        _debugPriceSource: priceSource.slice(0, 150),
        _debugHasPriceEl: !!priceEl,
        _debugImgAttrs: img ? {
          src: img.getAttribute('src'),
          dataSrc: img.getAttribute('data-src'),
          dataOriginal: img.getAttribute('data-original'),
          dataLazySrc: img.getAttribute('data-lazy-src'),
          srcset: img.getAttribute('srcset')
        } : null,
        _debugContainerClass: (container.className && typeof container.className === 'string') ? container.className.slice(0, 150) : String(container.getAttribute && container.getAttribute('class') || ''),
        _debugContainerHtml: container.outerHTML.slice(0, 400)
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

    // 591 的物件圖片是懶載入，只有捲到可視範圍才會真正載入圖片網址，
    // 先把整頁捲過一遍，讓更多卡片的圖片有機會載入完成再擷取。
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    const items = await extractListings(page);
    const statusCode = response ? response.status() : 0;

    if (items.length > 0) {
      console.log('--- 除錯資訊（抓到物件，檢查價格/圖片擷取，只印前 3 筆） ---');
      for (const it of items.slice(0, 3)) {
        console.log(JSON.stringify({
          id: it.id,
          title: it.title.slice(0, 20),
          price: it.price,
          cover: it.cover,
          debugPriceSource: it._debugPriceSource,
          debugHasPriceEl: it._debugHasPriceEl,
          debugImgAttrs: it._debugImgAttrs
        }));
      }

      const problemItems = items.filter(it => it.price === 0 || !it.cover);
      if (problemItems.length > 0) {
        console.log(`--- 除錯資訊（價格=0 或無圖片的物件，共 ${problemItems.length} 筆，只印前 5 筆） ---`);
        for (const it of problemItems.slice(0, 5)) {
          console.log(JSON.stringify({
            id: it.id,
            title: it.title.slice(0, 20),
            price: it.price,
            cover: it.cover,
            debugPriceSource: it._debugPriceSource,
            debugHasPriceEl: it._debugHasPriceEl,
            debugImgAttrs: it._debugImgAttrs,
            debugContainerClass: it._debugContainerClass,
            debugContainerHtml: it._debugContainerHtml
          }));
        }
      } else {
        console.log('--- 除錯資訊：這批物件全部都有正確價格與圖片 ---');
      }
    }

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
