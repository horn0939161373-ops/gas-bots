// ============================================================
// watchlist.js ─ 讀取關注清單、用關鍵字比對出使用者想追蹤的手機
// ============================================================

const fs = require('fs');

function loadWatchlist(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(s => String(s).trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// 關注清單裡的字串，只要是掃到的手機標題的子字串（不分大小寫）就算命中。
// 選取網頁（docs/index.html）產生的內容就是直接複製掃到的完整標題，
// 所以正常情況下一定會精準命中；使用者手動編輯只填部分關鍵字（例如
// 「iPhone 17 Pro」不含容量）也可以，會命中所有符合的容量版本。
function matchWatchlist(phones, keywords) {
  if (!keywords.length) return [];
  const lowerKeywords = keywords.map(k => k.toLowerCase());
  return phones.filter(p => {
    const title = p.title.toLowerCase();
    return lowerKeywords.some(k => title.includes(k));
  });
}

module.exports = { loadWatchlist, matchWatchlist };
