// ============================================================
// geocode.js ─ 把地址文字轉成經緯度座標，並計算跟指定地標的距離
// ============================================================
//
// 591 頁面本身沒有提供物件的經緯度座標（只有「行政區-路名」這種地址
// 文字），所以用 OpenStreetMap 的免費地理編碼服務 Nominatim 把地址轉
// 成座標。Nominatim 的使用規範要求：(1) 加上識別用的 User-Agent，
// (2) 請求之間至少間隔 1 秒，不能無限併發打。查過的地址會快取起來，
// 同一條路不會每次都重新查一次。

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = '591-rent-notify-bot/1.0 (personal use, github actions)';
const RATE_LIMIT_MS = 1100;

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 兩點經緯度之間的距離（公里），Haversine 公式 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 呼叫 Nominatim 把地址文字轉成 { lat, lon }，查不到回傳 null */
async function geocodeAddress(address) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=tw`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim 回應失敗: ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lon: Number(results[0].lon) };
}

/**
 * 幫一批物件（每筆需要有 address 欄位）查座標並算距離，用快取避免同一條
 * 路重複查詢。只對「快取裡沒有」的新地址發請求，並在每次請求之間間隔
 * 一段時間，符合 Nominatim 的使用規範。
 *
 * @param {Array<{id:string,address:string}>} items
 * @param {{lat:number, lon:number}} landmark
 * @param {Object} cache 既有的地址→座標快取（會被就地更新）
 * @returns {Promise<Map<string, {lat:number, lon:number, distanceKm:number}|null>>} 以物件 id 為 key
 */
async function geocodeAndMeasure(items, landmark, cache) {
  const results = new Map();
  let firstRequest = true;

  for (const item of items) {
    const address = (item.address || '').trim();
    if (!address) {
      results.set(item.id, null);
      continue;
    }

    const fullAddress = `高雄市${address.replace(/^高雄市/, '')}`;

    if (cache[fullAddress]) {
      const { lat, lon } = cache[fullAddress];
      results.set(item.id, { lat, lon, distanceKm: distanceKm(lat, lon, landmark.lat, landmark.lon) });
      continue;
    }

    if (!firstRequest) await _sleep(RATE_LIMIT_MS);
    firstRequest = false;

    try {
      const coord = await geocodeAddress(fullAddress);
      if (coord) {
        cache[fullAddress] = coord;
        results.set(item.id, { ...coord, distanceKm: distanceKm(coord.lat, coord.lon, landmark.lat, landmark.lon) });
      } else {
        results.set(item.id, null);
      }
    } catch (e) {
      console.log(`⚠️ 地理編碼失敗（${fullAddress}）: ${e.message}`);
      results.set(item.id, null);
    }
  }

  return results;
}

module.exports = { distanceKm, geocodeAddress, geocodeAndMeasure };
