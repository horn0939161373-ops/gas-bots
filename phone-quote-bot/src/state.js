// ============================================================
// state.js ─ 已推播過的手機報價（id → 上次推播價格）讀寫，存成 repo 裡的 JSON 檔
// ============================================================

const fs = require('fs');

function loadPriceMap(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}

function savePriceMap(path, priceMap) {
  fs.writeFileSync(path, JSON.stringify(priceMap, null, 2) + '\n');
}

module.exports = { loadPriceMap, savePriceMap };
