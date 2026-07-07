// 偵察版：找出 591 行政區選單資料的實際來源（HTML 結構 / API 回應）
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ userAgent: UA });

  // 攔截所有 JSON 回應，找含行政區名稱的
  page.on('response', async (res) => {
    try {
      const ct = (res.headers()['content-type'] || '');
      if (!/json|javascript/.test(ct)) return;
      const text = await res.text();
      if (text.length > 500000) return;
      if (/中和區|西屯區|左營區|板橋區/.test(text)) {
        console.log('>>> 含行政區名稱的回應:', res.url().slice(0, 200));
        const i = text.indexOf('中和區');
        console.log('    前後文:', JSON.stringify(text.slice(Math.max(0, i - 300), i + 200)));
      }
    } catch (e) { /* ignore */ }
  });

  await page.goto('https://rent.591.com.tw/list?region=3', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const html = await page.content();
  console.log('HTML 長度:', html.length);
  for (const probe of ['中和區', '永和區', '淡水區', '三峽區']) {
    let idx = html.indexOf(probe);
    let n = 0;
    while (idx >= 0 && n < 2) {
      console.log(`【${probe} #${n} @${idx}】`, JSON.stringify(html.slice(Math.max(0, idx - 350), idx + 120)));
      idx = html.indexOf(probe, idx + 1);
      n++;
    }
    if (n === 0) console.log(`【${probe}】HTML 裡沒出現`);
  }

  // 點開「位置」篩選器再抓一次（選單可能懶載入）
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div,span,button,a')).filter(e => {
      const t = (e.textContent || '').trim();
      return t === '新北市' || t === '位置' || /^新北市/.test(t) && t.length < 8;
    });
    if (els.length) { els[0].click(); return els[0].outerHTML.slice(0, 200); }
    return null;
  });
  console.log('點擊位置篩選器:', clicked ? '成功 ' + JSON.stringify(clicked) : '沒找到可點元素');
  await page.waitForTimeout(3000);

  const html2 = await page.content();
  console.log('點擊後 HTML 長度:', html2.length);
  for (const probe of ['中和區', '淡水區']) {
    let idx = html2.indexOf(probe);
    let n = 0;
    while (idx >= 0 && n < 3) {
      console.log(`【點擊後 ${probe} #${n} @${idx}】`, JSON.stringify(html2.slice(Math.max(0, idx - 350), idx + 120)));
      idx = html2.indexOf(probe, idx + 1);
      n++;
    }
    if (n === 0) console.log(`【點擊後 ${probe}】HTML 裡沒出現`);
  }

  await browser.close();
})();
