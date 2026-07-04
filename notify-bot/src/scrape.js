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
    // 591 自訂租金區間用「逗號」分隔（min,max），不是底線；用底線 591 不
    // 會套用價格篩選。
    params.set('rentprice', `${filter.priceMin || 0},${filter.priceMax || 999999}`);
  }
  // 591 搜尋關鍵字參數名稱是 keywords（複數），用單數 keyword 會被忽略。
  if (filter.keyword) params.set('keywords', filter.keyword);
  // 設備篩選分屬兩個參數：家電在 option、陽台/電梯/寵物/開伙在 other。
  const facilities = filter.facilities || {};
  if (facilities.option && facilities.option.length) params.set('option', facilities.option.join(','));
  if (facilities.other && facilities.other.length) params.set('other', facilities.other.join(','));
  // 依刊登時間新到舊排序，這樣才能直接取「最新 N 筆」，不用每次把整批
  // 搜尋結果都掃過一輪。
  params.set('order', 'posttime');
  params.set('orderType', 'desc');
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
    // 591 頁面上除了主列表卡片，篩選欄/瀏覽紀錄等側邊小工具偶爾也會出現
    // 連到同一個物件 id 的連結。這些區塊本身可能剛好也有「class 帶
    // price」的元素（例如價格區間篩選下拉選單）跟裝飾用的小圖示，如果
    // 把這種錨點也一起納入容器範圍，容易誤爬到這些不相關的小工具、抓出
    // 篩選選單的文字當價格（實測發現過一次）。用 class 關鍵字排除掉這些
    // 已知不是列表卡片的區塊。
    function isInExcludedRegion(el) {
      let node = el;
      while (node) {
        const cls = (node.className && typeof node.className === 'string')
          ? node.className
          : String((node.getAttribute && node.getAttribute('class')) || '');
        if (/filter|tools|history|search-panel|search-bar/i.test(cls)) return true;
        node = node.parentElement;
      }
      return false;
    }

    // 物件詳情頁連結的網址格式固定是「網域後面第一段路徑就是純數字 id」
    // （例如 https://rent.591.com.tw/21493915 或相對路徑 /21493915）。
    // 之前用「href 裡任何地方出現 /6位數以上數字」當判斷，結果連「?redirect=
    // /21493915」這種把物件 id 包在查詢字串裡的無關連結（例如篩選欄的
    // 「登入後查看」導回連結）也會誤判成物件連結，把不相關的小工具錨點
    // 一起併入該物件的容器範圍。改成要求數字必須緊接在網域後面（或本身
    // 就是相對路徑開頭），排除掉這種誤判。
    function matchListingId(href) {
      return href.match(/^(?:https?:\/\/[^/]+)?\/(\d{6,})(?:[/?]|$)/);
    }

    const idToAnchors = new Map();
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = matchListingId(href);
      if (!m) continue;
      if (isInExcludedRegion(a)) continue;
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
        const m2 = matchListingId(href2);
        if (m2 && m2[1] !== postId) return true;
      }
      return false;
    }

    // 圖片網址擷取：591 用懶載入，src 常常是 data: URI 佔位圖或
    // list-loading.gif 這種載入動畫，真正的網址在 data-src 等屬性。之前只
    // 排除 data: URI，結果 src 上的 list-loading.gif（非空字串、不是 data:）
    // 會被當成「已抓到」直接回傳，真正的 data-src 反而被跳過，導致存下來
    // 的 cover 全是那張載入動畫（實測 state 檔裡確實一堆 list-loading.gif）。
    // 另外 591 的圖片網址常是協定相對格式（//img1.591.com.tw/...），LINE 的
    // image 元件只收 https://，所以在這裡就補成 https，避免被誤判成不合法。
    function normalizeUrl(u) {
      if (!u) return '';
      const s = u.trim();
      if (!s) return '';
      if (s.startsWith('data:')) return '';
      // 懶載入／無圖時的佔位圖，視同沒抓到，讓後面的 data-src 有機會勝出。
      if (/list-loading|loading\.gif|blank\.|spacer|nophoto|no-photo|noimage|no-image/i.test(s)) return '';
      if (s.startsWith('//')) return 'https:' + s;
      return s;
    }
    function pickImageUrl(img) {
      if (!img) return '';
      const candidates = [
        img.getAttribute('src'),
        img.getAttribute('data-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazy-src')
      ];
      for (const c of candidates) {
        const url = normalizeUrl(c);
        if (url) return url;
      }
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (srcset) {
        const first = normalizeUrl(srcset.split(',')[0].trim().split(' ')[0]);
        if (first) return first;
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
      // 頁面上的價格「區間篩選」下拉選單也帶 price class，裡面是一整串
      // 「不限／5000元以下／5000-10000元／...」的選項列表，而不是單一
      // 租金數字；用「出現不只一次『元』」或「含『不限』字樣」當特徵，
      // 排除掉誤爬到篩選選單本身的情況（實測發生過，容器排除法沒完全
      // 擋住所有變化）。
      const looksLikeFilterMenu = /不限/.test(priceSource) || (priceSource.match(/元/g) || []).length > 1;
      const priceMatch = !looksLikeFilterMenu && priceSource.match(/([\d,]{3,})\s*元/);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

      // 591 上不會有租金 0 元的物件；抓到 0 代表容器選錯了、不是真的卡片，
      // 與其推播一張看起來壞掉的 $0 卡片，不如直接跳過這筆，等下次排程
      // （選取器邏輯不變的話，同一筆物件下次多半還是抓不到，但至少不會
      // 把明顯錯誤的資料推給使用者）。
      if (price === 0) continue;

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
      // 除錯用：研究能不能做「距離篩選」，先看頁面上有沒有現成的地址/
      // 經緯度資料可以用（例如 Vue SSR 常見的全域初始狀態物件），這樣才
      // 不用另外呼叫地理編碼 API 或多開一堆物件詳情頁。
      const geoDebug = await page.evaluate(() => {
        const globalKeys = Object.keys(window).filter(k => /state|nuxt|initial|__NEXT|preload/i.test(k));
        const anchors = document.querySelectorAll('a[href]');
        let firstContainer = null;
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          if (/^(?:https?:\/\/[^/]+)?\/(\d{6,})(?:[/?]|$)/.test(href)) {
            firstContainer = a.closest('li') || a.closest('article') || a.parentElement;
            break;
          }
        }
        const dataAttrs = firstContainer
          ? Array.from(firstContainer.querySelectorAll('*')).slice(0, 50).flatMap(el =>
              Array.from(el.attributes || [])
                .filter(attr => /lat|lng|lon|geo|address|addr/i.test(attr.name))
                .map(attr => `${attr.name}=${attr.value}`)
            )
          : [];
        const firstCardText = firstContainer ? firstContainer.innerText.slice(0, 300) : '';

        // 深入 __NUXT__ 全域初始狀態物件，找看看有沒有座標或地址欄位。
        // 591 頁面上會顯示「距OO醫院217公尺」這種資訊，代表後端一定算過
        // 座標，這裡碰運氣看前端拿到的初始資料裡有沒有一起帶出來。
        let nuxtMatches = [];
        let firstItemKeys = null;
        let firstItemRaw = null;
        try {
          const seen = new WeakSet();
          const keyRegex = /^(lat|lng|lon|latitude|longitude|address|addr|coord)/i;
          function walk(obj, path, depth) {
            if (nuxtMatches.length >= 40 || depth > 6 || !obj || typeof obj !== 'object') return;
            if (seen.has(obj)) return;
            seen.add(obj);
            for (const key of Object.keys(obj)) {
              if (nuxtMatches.length >= 40) return;
              let val;
              try { val = obj[key]; } catch (e) { continue; }
              if (keyRegex.test(key) && (typeof val === 'number' || typeof val === 'string')) {
                nuxtMatches.push(`${path}.${key} = ${JSON.stringify(val).slice(0, 60)}`);
              } else if (val && typeof val === 'object') {
                walk(val, `${path}.${key}`, depth + 1);
              }
            }
          }
          walk(window.__NUXT__, '__NUXT__', 0);

          // 找到帶 address 欄位的那個 items 陣列後，把它「第一筆」的所有
          // 欄位名稱跟完整內容都印出來，這樣才不會漏看沒被上面關鍵字猜到
          // 的座標欄位名稱（例如可能叫 position/geo/point/x/y 之類）。
          function findItemsArray(obj, depth, seen2) {
            if (!obj || typeof obj !== 'object' || depth > 8) return null;
            if (seen2.has(obj)) return null;
            seen2.add(obj);
            if (Array.isArray(obj) && obj.length > 0 && obj[0] && typeof obj[0] === 'object' && 'address' in obj[0]) {
              return obj;
            }
            for (const key of Object.keys(obj)) {
              let val;
              try { val = obj[key]; } catch (e) { continue; }
              const found = findItemsArray(val, depth + 1, seen2);
              if (found) return found;
            }
            return null;
          }
          const itemsArr = findItemsArray(window.__NUXT__, 0, new WeakSet());
          if (itemsArr && itemsArr[0]) {
            firstItemKeys = Object.keys(itemsArr[0]);
            firstItemRaw = JSON.stringify(itemsArr[0]).slice(0, 1500);
          }
        } catch (e) {
          nuxtMatches = [`(讀取 __NUXT__ 時出錯: ${e.message})`];
        }

        return { globalKeys, dataAttrs, firstCardText, nuxtMatches, firstItemKeys, firstItemRaw };
      });
      console.log('--- 除錯資訊（研究距離篩選可行性：全域變數/地址屬性/卡片全文/__NUXT__ 座標搜尋） ---');
      console.log(JSON.stringify(geoDebug));

      console.log('--- 除錯資訊（全部物件的 id/price/cover 簡表） ---');
      console.log(JSON.stringify(items.map(it => ({ id: it.id, price: it.price, cover: it.cover ? 'ok' : 'empty' }))));

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
  const maxResults = filter.maxResults > 0 ? filter.maxResults : 10;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { items, statusCode } = await _fetchOnce(url);
    const blocked = statusCode >= 400;

    // 搜尋網址已加上「依刊登時間新到舊排序」，DOM 上物件出現的順序就是
    // 新到舊，取前 N 筆即為「最新 N 筆」，不用每次處理整批搜尋結果。
    if (!blocked || items.length > 0) return items.slice(0, maxResults);

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
