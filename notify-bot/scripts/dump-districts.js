// 偵察版 v2：確定 591 行政區選單資料的來源
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  let page = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    page = await browser.newPage({ userAgent: UA });

    page.on('response', async (res) => {
      try {
        const ct = (res.headers()['content-type'] || '');
        if (!/json|javascript/.test(ct)) return;
        const text = await res.text().catch(() => '');
        if (!text || text.length > 3000000) return;
        if (text.indexOf('中和區') >= 0) {
          const i = text.indexOf('中和區');
          console.log('>>> 回應含中和區:', res.url().slice(0, 180));
          console.log('    前後文:', JSON.stringify(text.slice(Math.max(0, i - 400), i + 200)));
        }
      } catch (e) { /* ignore */ }
    });

    const resp = await page.goto('https://rent.591.com.tw/list?region=3', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => null);
    await page.waitForTimeout(3500);
    const status = resp ? resp.status() : 0;
    const html = await page.content();
    console.log(`attempt=${attempt} status=${status} htmlLen=${html.length}`);
    if (status === 200 && html.length > 5000) break;
    await page.close();
    page = null;
    await new Promise(r => setTimeout(r, 4000));
  }
  if (!page) { console.log('!! 每次都被擋，放棄'); await browser.close(); return; }

  // 1) __NUXT__ 全量序列化搜尋
  const nuxtProbe = await page.evaluate(() => {
    let json = '';
    try { json = JSON.stringify(window.__NUXT__); } catch (e) { return { err: e.message }; }
    const out = { len: json.length, hits: [] };
    let idx = json.indexOf('中和區');
    let n = 0;
    while (idx >= 0 && n < 3) { out.hits.push(json.slice(Math.max(0, idx - 400), idx + 200)); idx = json.indexOf('中和區', idx + 1); n++; }
    try {
      const pinia = window.__NUXT__.pinia || {};
      out.piniaKeys = {};
      for (const k of Object.keys(pinia)) out.piniaKeys[k] = Object.keys(pinia[k] || {}).slice(0, 30);
    } catch (e) { out.piniaErr = e.message; }
    return out;
  });
  console.log('__NUXT__ 大小:', nuxtProbe.len, 'pinia stores:', JSON.stringify(nuxtProbe.piniaKeys || {}));
  (nuxtProbe.hits || []).forEach((h, i) => console.log(`__NUXT__ 中和區 hit#${i}:`, JSON.stringify(h)));
  if (!(nuxtProbe.hits || []).length) console.log('__NUXT__ 裡沒有「中和區」');

  // 2) 頁面 HTML 搜尋
  const html = await page.content();
  const hi = html.indexOf('中和區');
  console.log('HTML 含中和區?', hi >= 0 ? JSON.stringify(html.slice(Math.max(0, hi - 350), hi + 120)) : '否');

  // 3) 列出所有可點的「含縣市名」元素（找位置篩選器）
  const clickables = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('*')) {
      const t = (e.textContent || '').trim();
      if (t.length > 0 && t.length <= 10 && /新北市|位置|區域/.test(t) && e.children.length === 0) {
        out.push({ tag: e.tagName, cls: String(e.className).slice(0, 80), text: t });
        if (out.length >= 15) break;
      }
    }
    return out;
  });
  console.log('候選可點元素:', JSON.stringify(clickables));

  // 4) 逐一嘗試點擊，看會不會展開含行政區的選單/發出 API
  for (let i = 0; i < Math.min(clickables.length, 6); i++) {
    const c = clickables[i];
    const ok = await page.evaluate((c) => {
      for (const e of document.querySelectorAll(c.tag)) {
        if ((e.textContent || '').trim() === c.text && String(e.className).slice(0, 80) === c.cls) { e.click(); return true; }
      }
      return false;
    }, c).catch(() => false);
    if (!ok) continue;
    await page.waitForTimeout(2500);
    const html2 = await page.content();
    const j = html2.indexOf('中和區');
    console.log(`點了 ${c.text}(${c.tag}) → HTML 長度 ${html2.length}，中和區 ${j >= 0 ? '出現!' : '沒出現'}`);
    if (j >= 0) {
      console.log('  前後文:', JSON.stringify(html2.slice(Math.max(0, j - 400), j + 150)));
      const opts = await page.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('*')) {
          const t = (e.textContent || '').trim();
          if (/^[一-鿿]{1,3}區$/.test(t) && e.children.length <= 1) {
            const attrs = {};
            for (const a of e.attributes || []) attrs[a.name] = String(a.value).slice(0, 40);
            out.push({ tag: e.tagName, text: t, attrs, parentCls: e.parentElement ? String(e.parentElement.className).slice(0, 60) : '' });
            if (out.length >= 15) break;
          }
        }
        return out;
      });
      console.log('  選單元素取樣:', JSON.stringify(opts));
      break;
    }
  }

  await browser.close();
})();
