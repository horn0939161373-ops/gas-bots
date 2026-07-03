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

module.exports = { loadSeenIds, saveSeenIds };
