// ============================================================
// subscriptions.js ─ 多人版：載入每個使用者的訂閱條件並依「相同搜尋條件」分組
// ============================================================
//
// 訂閱清單來源：優先讀環境變數 SUBSCRIPTIONS_URL（GAS Web App 提供的 JSON
// 端點）；沒設定時退回讀本地 subscriptions.json（方便本機測試）。
// 每筆訂閱的欄位跟單人版 config.json 一樣（region/district/priceMin/...），
// 再多一個 userId（要推播的 LINE 對象）與可選的 name、enabled。

const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('./config');

function normalize(data) {
  const arr = Array.isArray(data)
    ? data
    : (data && Array.isArray(data.subscriptions) ? data.subscriptions : []);
  // 只留有 userId、且沒有被停用的訂閱
  return arr
    .filter(s => s && s.userId && s.enabled !== false)
    // 一人可有多組條件：每組用 subId 當獨立身分（各自去重）；沒有 subId
    // 的舊資料退回用 userId 當 key。
    .map(s => Object.assign({}, s, { subKey: String(s.subId || s.userId) }));
}

async function loadSubscriptions() {
  const url = process.env.SUBSCRIPTIONS_URL;
  if (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`載入訂閱清單失敗: ${res.status} ${text.slice(0, 200)}`);
    }
    return normalize(await res.json());
  }
  const localPath = path.join(__dirname, '..', 'subscriptions.json');
  try {
    return normalize(JSON.parse(fs.readFileSync(localPath, 'utf8')));
  } catch (e) {
    return [];
  }
}

// 把 resolveConfig() 產生的 filter 轉成一個可比較的字串 key：搜尋條件完全
// 相同的訂閱會得到相同 key，就能歸成一組、只抓一次。
function filterKey(f) {
  const fac = f.facilities || {};
  return JSON.stringify([
    f.region, f.section, f.kind, f.priceMin, f.priceMax, f.keyword,
    (fac.option || []).slice().sort(), (fac.other || []).slice().sort()
  ]);
}

// 回傳 [{ key, filter, subs: [...訂閱] }]，同條件的人共用一次抓取結果。
// maxResults 取同組裡最大的那個，確保每個人要看的筆數都涵蓋得到。
function groupByFilter(subscriptions) {
  const groups = new Map();
  for (const sub of subscriptions) {
    const filter = resolveConfig(sub);
    const key = filterKey(filter);
    if (!groups.has(key)) groups.set(key, { key, filter, subs: [] });
    const g = groups.get(key);
    g.subs.push(sub);
    if (filter.maxResults > g.filter.maxResults) g.filter.maxResults = filter.maxResults;
  }
  return [...groups.values()];
}

module.exports = { loadSubscriptions, normalize, filterKey, groupByFilter };
