// ============================================================
// config.js ─ 把 config.json 的中文友善欄位轉成 591 查詢用的代碼
// ============================================================

// 縣市代碼已用實際 591 網址（rent.591.com.tw/list?region=N）逐一核對過
const REGION_MAP = {
  '台北市': 1, '基隆市': 2, '新北市': 3, '新竹市': 4, '新竹縣': 5, '桃園市': 6,
  '苗栗縣': 7, '台中市': 8, '彰化縣': 10, '南投縣': 11, '嘉義市': 12, '嘉義縣': 13,
  '雲林縣': 14, '台南市': 15, '高雄市': 17, '屏東縣': 19, '宜蘭縣': 21,
  '台東縣': 22, '花蓮縣': 23, '澎湖縣': 24, '金門縣': 25
};

const ROOM_TYPE_MAP = {
  '不限': '0', '整層住家': '1', '獨立套房': '2', '分租套房': '3', '雅房': '4', '別墅': '5'
};

// 縣市內行政區代碼（591 的 section 參數），已用實際 591 網址逐一核對過。
// 目前只先建了高雄市（因應中山大學附近的搜尋需求），其他縣市的行政區
// 需要時用同樣方式（到 591 網站選好行政區，從網址列的 section= 參數
// 取得代碼）再補進來；也可以直接在 config.json 的 district 欄位填數字代碼。
const SECTION_MAP = {
  '17': { // 高雄市
    '新興區': 243, '前金區': 244, '苓雅區': 245, '鹽埕區': 246, '鼓山區': 247,
    '前鎮區': 249, '三民區': 250, '楠梓區': 251, '左營區': 253, '鳳山區': 268
  }
};

// 把單一行政區名稱（或數字代碼）轉成 591 的 section 代碼。查無則回傳 ''。
function resolveOneDistrict(regionCode, name) {
  const trimmed = String(name).trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return trimmed; // 允許直接填數字代碼
  const districts = SECTION_MAP[regionCode];
  if (!districts) {
    console.log(`⚠️ 目前還沒有這個縣市（region=${regionCode}）的行政區代碼表，「${trimmed}」將被忽略，只用縣市層級搜尋。`);
    return '';
  }
  if (districts[trimmed] != null) return String(districts[trimmed]);
  const key = Object.keys(districts).find(k => trimmed.includes(k));
  if (key) return String(districts[key]);
  console.log(`⚠️ 無法辨識行政區「${trimmed}」，請對照 notify-bot/README.md 的行政區代碼表。`);
  return '';
}

// 支援一次填多個行政區（591 的 section 參數可用逗號串多個），可用半形或
// 全形逗號、頓號、空白分隔，例如 "鼓山區,前金區,鹽埕區"。回傳以逗號串起
// 的 section 代碼字串。
function resolveDistrict(regionCode, name) {
  if (name == null || name === '') return '';
  let raw = String(name).trim();
  // Google 試算表會把「244,245,246,247」這種逗號分隔的代碼字串當成
  // 「千分位數字」自動轉成 244245246247，GAS 讀回來就是一長串數字，
  // 直接當 section 送給 591 會查不到任何物件（實際發生過，通知因此
  // 完全中斷）。千分位的分組固定是從右往左每 3 位一組，照同樣規則
  // 切回來即可還原原本的代碼清單（591 的 section 代碼皆不超過 3 位數）。
  if (/^\d{4,}$/.test(raw)) {
    const parts = [];
    let s = raw;
    while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
    parts.unshift(s);
    raw = parts.join(',');
    console.log(`⚠️ district「${name}」疑似被試算表轉成數字，自動還原為「${raw}」`);
  }
  const parts = raw.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
  const codes = parts.map(p => resolveOneDistrict(regionCode, p)).filter(Boolean);
  return codes.join(',');
}

// 設備 boolean 欄位 → 591 篩選代碼。注意：591 把設備拆成「兩個不同的
// 網址參數」——冷氣等家電屬於 option，陽台/電梯/寵物/開伙屬於 other。
// 之前全部塞進 option，結果 591 只認得冷氣（cold），陽台/電梯/寵物/開伙
// 四項篩選其實完全沒生效，所以這裡記下每個欄位對應的參數群組。
const FACILITY_FIELD_MAP = {
  balcony: { param: 'other', value: 'balcony_1' },
  elevator: { param: 'other', value: 'lift' },
  pet: { param: 'other', value: 'pet' },
  airConditioner: { param: 'option', value: 'cold' },
  cooking: { param: 'other', value: 'cook' }
};

function resolveRegion(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (/^\d+$/.test(trimmed)) return trimmed; // 允許直接填數字代碼
  if (REGION_MAP[trimmed] != null) return String(REGION_MAP[trimmed]);
  const key = Object.keys(REGION_MAP).find(k => trimmed.includes(k));
  if (key) return String(REGION_MAP[key]);
  console.log(`⚠️ 無法辨識地區「${name}」，請對照 notify-bot/README.md 的縣市代碼表。`);
  return '';
}

function resolveRoomType(name) {
  if (!name) return '0';
  const trimmed = String(name).trim();
  if (/^[0-5]$/.test(trimmed)) return trimmed; // 允許直接填數字代碼
  if (ROOM_TYPE_MAP[trimmed] != null) return ROOM_TYPE_MAP[trimmed];
  console.log(`⚠️ 無法辨識房型「${name}」，將視為不限。`);
  return '0';
}

/** 把 config.json 讀到的物件轉成 scrapeListings() 需要的 filter 格式 */
function resolveConfig(config) {
  // 依 591 的參數群組分別收集：option（家電）與 other（陽台/電梯等）。
  const facilities = { option: [], other: [] };
  for (const field of Object.keys(FACILITY_FIELD_MAP)) {
    if (config[field] === true) {
      const { param, value } = FACILITY_FIELD_MAP[field];
      facilities[param].push(value);
    }
  }

  const region = resolveRegion(config.region);

  return {
    region,
    section: resolveDistrict(region, config.district),
    priceMin: Number(config.priceMin) || 0,
    priceMax: Number(config.priceMax) || 0,
    kind: resolveRoomType(config.roomType),
    keyword: config.keyword || '',
    facilities,
    maxResults: Number(config.maxResults) > 0 ? Number(config.maxResults) : 10
  };
}

module.exports = { resolveConfig, REGION_MAP, ROOM_TYPE_MAP, FACILITY_FIELD_MAP, SECTION_MAP };
