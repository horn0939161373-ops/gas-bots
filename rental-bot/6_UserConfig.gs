// ============================================================
// 6_UserConfig.gs ─ 使用者篩選條件 CRUD + 設定精靈狀態(Session)
// ============================================================

const FILTER_SHEET      = "UserFilterConfig";
const FILTER_HEADERS    = ["userId","region","priceMin","priceMax","kind","keyword","facilities","pushEnabled","updatedAt"];
const SESSION_CACHE_TTL = 600; // 精靈進行中的暫存狀態，10 分鐘無回應則失效

// ─── 設定精靈 Session（CacheService 暫存，非永久資料） ─────────

function getSession(userId) {
  const raw = CacheService.getScriptCache().get("session_" + userId);
  return raw ? JSON.parse(raw) : null;
}
function setSession(userId, session) {
  CacheService.getScriptCache().put("session_" + userId, JSON.stringify(session), SESSION_CACHE_TTL);
}
function clearSession(userId) {
  CacheService.getScriptCache().remove("session_" + userId);
}

function startFilterWizard(userId) {
  setSession(userId, { step: "region", facilities: [] });
}

// ─── 精靈：文字輸入步驟（地區 → 價格 → 關鍵字） ────────────────

function handleWizardTextInput(replyToken, userId, session, msg) {
  switch (session.step) {
    case "region": {
      const region = resolveRegionInput(msg);
      if (!region) {
        replyTextMessage(replyToken,
          `抱歉，無法辨識「${msg}」。\n請輸入縣市名稱（如：台北市）或 591 的 region 數字代碼。`);
        return;
      }
      session.region = region;
      session.step = "price";
      setSession(userId, session);
      replyTextMessage(replyToken, "💰 請輸入租金區間（例如：5000-15000），不限請輸入「不限」。");
      return;
    }

    case "price": {
      if (msg === "不限") {
        session.priceMin = 0; session.priceMax = 0;
      } else {
        const m = msg.match(/(\d+)\s*-\s*(\d+)/);
        if (!m) {
          replyTextMessage(replyToken, "格式不對喔，請輸入像「5000-15000」這樣的區間，或輸入「不限」。");
          return;
        }
        session.priceMin = Number(m[1]);
        session.priceMax = Number(m[2]);
      }
      session.step = "kind";
      setSession(userId, session);
      replyFlexMessage(replyToken, "請選擇房型", FlexMessage.getKindPickerCard());
      return;
    }

    case "keyword": {
      session.keyword = (msg === "略過" || msg === "跳過") ? "" : msg;
      session.step = "facility";
      setSession(userId, session);
      replyFlexMessage(replyToken, "請選擇想要的設備（可複選，選完按完成）", FlexMessage.getFacilityPickerCard([]));
      return;
    }

    default:
      clearSession(userId);
      replyTextMessage(replyToken, "設定流程已中斷，請重新輸入「選單」開始。");
  }
}

function handleWizardPickKind(replyToken, userId, kind) {
  const session = getSession(userId);
  if (!session) { replyTextMessage(replyToken, "設定流程已逾時，請重新輸入「選單」開始。"); return; }
  session.kind = kind;
  session.step = "keyword";
  setSession(userId, session);
  replyTextMessage(replyToken, "🔎 想篩選特定關鍵字嗎？（例如：近捷運、可養寵物）\n不需要請輸入「略過」。");
}

function handleWizardToggleFacility(replyToken, userId, facility) {
  const session = getSession(userId);
  if (!session) { replyTextMessage(replyToken, "設定流程已逾時，請重新輸入「選單」開始。"); return; }
  const idx = session.facilities.indexOf(facility);
  if (idx >= 0) session.facilities.splice(idx, 1);
  else session.facilities.push(facility);
  setSession(userId, session);
  replyFlexMessage(replyToken, "已更新設備選擇", FlexMessage.getFacilityPickerCard(session.facilities));
}

function finishWizardAndSave(replyToken, userId) {
  const session = getSession(userId);
  if (!session) { replyTextMessage(replyToken, "設定流程已逾時，請重新輸入「選單」開始。"); return; }
  saveUserFilter(userId, session);
  clearSession(userId);
  replyFlexMessage(replyToken, "✅ 篩選條件已儲存！", FlexMessage.getFilterSummaryCard(getUserFilter(userId), true));
}

// ─── 篩選條件存取（Google Sheet 永久儲存） ──────────────────────

function saveUserFilter(userId, f) {
  const sheet = getOrCreateSheet(FILTER_SHEET, FILTER_HEADERS);
  const data  = sheet.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === userId) { row = i + 1; break; }
  }
  const record = [
    userId, f.region, f.priceMin || 0, f.priceMax || 0,
    f.kind || "0", f.keyword || "", (f.facilities || []).join(","),
    true, nowTimestamp()
  ];
  if (row === -1) sheet.appendRow(record);
  else sheet.getRange(row, 1, 1, record.length).setValues([record]);
}

function getUserFilter(userId) {
  const sheet = getOrCreateSheet(FILTER_SHEET, FILTER_HEADERS);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === userId) {
      return {
        userId, region: data[i][1], priceMin: Number(data[i][2]) || 0,
        priceMax: Number(data[i][3]) || 0, kind: String(data[i][4] || "0"),
        keyword: data[i][5] || "", facilities: String(data[i][6] || "").split(",").filter(Boolean),
        pushEnabled: data[i][7] === true || String(data[i][7]).toUpperCase() === "TRUE",
        row: i + 1
      };
    }
  }
  return null;
}

function getAllEnabledFilters() {
  const sheet = getOrCreateSheet(FILTER_SHEET, FILTER_HEADERS);
  const data  = sheet.getDataRange().getValues();
  const list  = [];
  for (let i = 1; i < data.length; i++) {
    const enabled = data[i][7] === true || String(data[i][7]).toUpperCase() === "TRUE";
    if (!enabled) continue;
    list.push({
      userId: String(data[i][0]).trim(), region: data[i][1],
      priceMin: Number(data[i][2]) || 0, priceMax: Number(data[i][3]) || 0,
      kind: String(data[i][4] || "0"), keyword: data[i][5] || "",
      facilities: String(data[i][6] || "").split(",").filter(Boolean)
    });
  }
  return list;
}

function setPushEnabled(userId, enabled) {
  const f = getUserFilter(userId);
  if (!f) return false;
  const sheet = getOrCreateSheet(FILTER_SHEET, FILTER_HEADERS);
  sheet.getRange(f.row, 8).setValue(enabled);
  return enabled;
}

// ─── 縣市名稱 → 591 region 代碼 ──────────────────────────────
// 對照表已透過實際 591 網址（rent.591.com.tw/list?region=N）逐一核對過，
// 唯獨「連江縣」查無資料，暫不支援。若日後 591 調整代碼，
// 請直接到 591 網站選好縣市後，從網址列的 region= 參數取得正確代碼並修改此表。
const REGION_MAP = {
  "台北市": 1, "基隆市": 2, "新北市": 3, "新竹市": 4, "新竹縣": 5, "桃園市": 6,
  "苗栗縣": 7, "台中市": 8, "彰化縣": 10, "南投縣": 11, "嘉義市": 12, "嘉義縣": 13,
  "雲林縣": 14, "台南市": 15, "高雄市": 17, "屏東縣": 19, "宜蘭縣": 21,
  "台東縣": 22, "花蓮縣": 23, "澎湖縣": 24, "金門縣": 25
};

function resolveRegionInput(msg) {
  const trimmed = String(msg).trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const key = Object.keys(REGION_MAP).find(k => k === trimmed || trimmed.includes(k));
  return key ? String(REGION_MAP[key]) : null;
}
