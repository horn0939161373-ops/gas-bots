// ============================================================
// state.js ─ 已推播物件 id 的讀寫（存成 repo 內的 JSON 檔）
// ============================================================

const fs = require('fs');

const MAX_KEEP = 500;

function loadSeenIds(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveSeenIds(path, ids) {
  const trimmed = ids.slice(-MAX_KEEP);
  fs.writeFileSync(path, JSON.stringify(trimmed, null, 2) + '\n');
}

/** 讀取保留下來的完整物件資料（不只 id，還有標題/價格/圖片/連結），用物件 id 當 key */
function loadListingsData(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

/**
 * 把這次抓到的物件完整資料（不只 id）合併寫回去，方便之後回顧「之前
 * 到底抓到了什麼」，而不是只有一串 id。同一物件重複抓到時用最新一次
 * 的資料覆蓋（例如價格可能會變動）。超過上限時，優先保留最近抓到的。
 */
function saveListingsData(path, listings, existing) {
  const merged = { ...existing };
  const now = new Date().toISOString();
  for (const item of listings) {
    merged[item.id] = {
      id: item.id,
      title: item.title,
      price: item.price,
      cover: item.cover,
      url: item.url,
      address: item.address || (existing[item.id] && existing[item.id].address) || '',
      distanceKm: typeof item.distanceKm === 'number' ? item.distanceKm : (existing[item.id] ? existing[item.id].distanceKm : null),
      scrapedAt: now
    };
  }
  const entries = Object.values(merged).sort((a, b) => (a.scrapedAt < b.scrapedAt ? -1 : 1));
  const trimmed = entries.slice(-MAX_KEEP);
  const result = Object.fromEntries(trimmed.map(item => [item.id, item]));
  fs.writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  return result;
}

module.exports = { loadSeenIds, saveSeenIds, loadListingsData, saveListingsData };
