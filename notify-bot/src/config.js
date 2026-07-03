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
    '新興區': 243, '苓雅區': 245, '鼓山區': 247, '前鎮區': 249,
    '三民區': 250, '楠梓區': 251, '左營區': 253, '鳳山區': 268
  }
};

function resolveDistrict(regionCode, name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (/^\d+$/.test(trimmed)) return trimmed; // 允許直接填數字代碼
  const districts = SECTION_MAP[regionCode];
  if (!districts) {
    console.log(`⚠️ 目前還沒有這個縣市（region=${regionCode}）的行政區代碼表，「${name}」將被忽略，只用縣市層級搜尋。`);
    return '';
  }
  if (districts[trimmed] != null) return String(districts[trimmed]);
  const key = Object.keys(districts).find(k => trimmed.includes(k));
  if (key) return String(districts[key]);
  console.log(`⚠️ 無法辨識行政區「${name}」，請對照 notify-bot/README.md 的行政區代碼表。`);
  return '';
}

// 設備 boolean 欄位 → 591 option 參數代碼
const FACILITY_FIELD_MAP = {
  balcony: 'balcony_1',
  elevator: 'lift',
  pet: 'pet',
  airConditioner: 'cold',
  cooking: 'cook'
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
  const facilities = Object.keys(FACILITY_FIELD_MAP)
    .filter(field => config[field] === true)
    .map(field => FACILITY_FIELD_MAP[field]);

  const region = resolveRegion(config.region);

  const df = config.distanceFilter || {};

  return {
    region,
    section: resolveDistrict(region, config.district),
    priceMin: Number(config.priceMin) || 0,
    priceMax: Number(config.priceMax) || 0,
    kind: resolveRoomType(config.roomType),
    keyword: config.keyword || '',
    facilities,
    maxResults: Number(config.maxResults) > 0 ? Number(config.maxResults) : 10,
    distanceFilter: {
      enabled: df.enabled === true && Number.isFinite(Number(df.landmarkLat)) && Number.isFinite(Number(df.landmarkLng)),
      landmarkName: df.landmarkName || '',
      landmarkLat: Number(df.landmarkLat),
      landmarkLng: Number(df.landmarkLng),
      maxDistanceKm: Number(df.maxDistanceKm) > 0 ? Number(df.maxDistanceKm) : 3
    }
  };
}

module.exports = { resolveConfig, REGION_MAP, ROOM_TYPE_MAP, FACILITY_FIELD_MAP, SECTION_MAP };
