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
 *
 * 回傳合併後的結果；多人版一輪內會對「多組條件」各存一次，呼叫端要用
 * 回傳值當下一次的 existing，否則後面那組會用迴圈開始前的舊資料當基底，
 * 把前面那組剛存的物件洗掉。
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
      scrapedAt: now
    };
  }
  const entries = Object.values(merged).sort((a, b) => (a.scrapedAt < b.scrapedAt ? -1 : 1));
  const trimmed = entries.slice(-MAX_KEEP);
  const result = Object.fromEntries(trimmed.map(item => [item.id, item]));
  fs.writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  return result;
}

// ── 多人版：每個 LINE 使用者各自一份已推紀錄 ──────────────────
// 存成一個物件：{ userId: [已推過的物件 id, ...] }，用同一個檔集中管理，
// Actions 每輪跑完 commit 回 repo。

function loadSubscriberSeen(path) {
  try {
    const obj = JSON.parse(fs.readFileSync(path, 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveSubscriberSeen(path, seenByUser) {
  const out = {};
  for (const [userId, ids] of Object.entries(seenByUser)) {
    out[userId] = (Array.isArray(ids) ? ids : []).slice(-MAX_KEEP);
  }
  fs.writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
}

module.exports = {
  loadSeenIds, saveSeenIds, loadListingsData, saveListingsData,
  loadSubscriberSeen, saveSubscriberSeen
};
