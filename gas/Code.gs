/**
 * 591 多人訂閱 ─ Google Apps Script Web App
 * ------------------------------------------------------------
 * 一支 GAS 同時扮演：
 *   1. 網頁表單：新增/編輯一組租屋條件（doGet 預設）
 *   2. 管理頁：查看/刪除自己的訂閱（doGet?action=manage&uid=）
 *   3. LINE webhook：加好友時取得 userId 並回設定/管理連結（doPost）
 *   4. 給 GitHub Actions 讀訂閱清單的 JSON 端點（doGet?action=list&token=）
 *
 * 一個人可以有「多組」條件（每列一組，subId 唯一）。
 * 資料存在同一份試算表的 "subscriptions" 工作表。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   LINE_CHANNEL_ACCESS_TOKEN  LINE OA channel access token（回覆用）
 *   API_TOKEN                  自訂隨機字串，Actions 讀清單時要帶
 *   SPREADSHEET_ID             存訂閱的試算表 ID
 */

var SHEET_NAME = 'subscriptions';
var HEADERS = ['subId', 'userId', 'name', 'region', 'district', 'priceMin', 'priceMax',
  'roomType', 'keyword', 'maxResults', 'balcony', 'elevator', 'pet',
  'airConditioner', 'cooking', 'enabled', 'updatedAt'];

// 縣市 → 行政區 → 591 section 代碼。目前只有高雄是逐一核對過的；其他縣市
// 之後補進來即可（補一個城市 = 加一個陣列）。沒列在這裡的縣市，表單會退回
// 讓使用者手動輸入行政區名稱或代碼。
var DISTRICTS_BY_REGION = {
  '高雄市': [
    ['新興區', 243], ['前金區', 244], ['苓雅區', 245], ['鹽埕區', 246],
    ['鼓山區', 247], ['前鎮區', 249], ['三民區', 250], ['楠梓區', 251],
    ['左營區', 253], ['鳳山區', 268]
  ]
};

function prop(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSheet_() {
  var ss = SpreadsheetApp.openById(prop('SPREADSHEET_ID'));
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
  }
  // 若表頭不完整（舊版），補成最新
  var head = sh.getRange(1, 1, 1, sh.getLastColumn() || 1).getValues()[0];
  if (head.join(',') !== HEADERS.join(',')) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 路由 ────────────────────────────────────────────────────
function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === 'list') {
    if (params.token !== prop('API_TOKEN')) return json_({ error: 'unauthorized' });
    return json_(readSubscriptions_(true)); // 只回啟用中的
  }

  if (params.action === 'manage') {
    var t = HtmlService.createTemplateFromFile('Manage');
    t.uid = params.uid || '';
    return t.evaluate().setTitle('我的 591 訂閱')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 預設：新增/編輯表單
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.uid = params.uid || '';
  tpl.subId = params.subId || '';
  tpl.districtsJson = JSON.stringify(DISTRICTS_BY_REGION);
  // 編輯模式：把該筆資料帶進去預填
  tpl.subJson = JSON.stringify(params.subId ? findSub_(params.subId, params.uid) : null);
  return tpl.evaluate().setTitle('591 租屋條件設定')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── 讀清單 ──────────────────────────────────────────────────
function readSubscriptions_(onlyEnabled) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) obj[header[c]] = values[i][c];
    if (!obj.userId) continue;
    obj.priceMin = Number(obj.priceMin) || 0;
    obj.priceMax = Number(obj.priceMax) || 0;
    obj.maxResults = Number(obj.maxResults) || 10;
    ['balcony', 'elevator', 'pet', 'airConditioner', 'cooking'].forEach(function (k) {
      obj[k] = obj[k] === true || obj[k] === 'TRUE' || obj[k] === 'true' || obj[k] === 1;
    });
    obj.enabled = !(obj.enabled === false || obj.enabled === 'FALSE' || obj.enabled === 'false');
    if (onlyEnabled && !obj.enabled) continue;
    out.push(obj);
  }
  return out;
}

function findSub_(subId, uid) {
  var all = readSubscriptions_(false);
  for (var i = 0; i < all.length; i++) {
    if (all[i].subId === subId && (!uid || all[i].userId === uid)) return all[i];
  }
  return null;
}

// ── 表單送出（前端 google.script.run 呼叫）──────────────────
function saveSubscription(data) {
  if (!data || !data.userId) throw new Error('缺少 userId');
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var rowIndex = -1;
  if (data.subId) {
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === data.subId && values[i][1] === data.userId) { rowIndex = i + 1; break; }
    }
  }
  var subId = data.subId || Utilities.getUuid();
  var record = [
    subId, data.userId, data.name || '', data.region || '', data.district || '',
    Number(data.priceMin) || 0, Number(data.priceMax) || 0,
    data.roomType || '不限', data.keyword || '', Number(data.maxResults) || 10,
    !!data.balcony, !!data.elevator, !!data.pet, !!data.airConditioner, !!data.cooking,
    true, new Date().toISOString()
  ];
  if (rowIndex > 0) {
    sh.getRange(rowIndex, 1, 1, record.length).setValues([record]);
  } else {
    sh.appendRow(record);
  }
  return { ok: true, subId: subId };
}

// 管理頁用：列出某人所有訂閱
function listMySubs(uid) {
  if (!uid) return [];
  return readSubscriptions_(false).filter(function (s) { return s.userId === uid; });
}

// 管理頁用：刪除自己的一筆訂閱（會驗證 userId，避免刪到別人）
function deleteSub(subId, uid) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === subId && values[i][1] === uid) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('找不到該訂閱');
}

// 管理頁用：暫停/恢復
function setEnabled(subId, uid, enabled) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var enCol = HEADERS.indexOf('enabled') + 1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === subId && values[i][1] === uid) {
      sh.getRange(i + 1, enCol).setValue(!!enabled);
      return { ok: true };
    }
  }
  throw new Error('找不到該訂閱');
}

// ── LINE webhook ────────────────────────────────────────────
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var events = body.events || [];
  var base = ScriptApp.getService().getUrl();
  events.forEach(function (ev) {
    var userId = ev.source && ev.source.userId;
    if (!userId) return;
    if (ev.type === 'follow' || ev.type === 'message') {
      var addLink = base + '?uid=' + encodeURIComponent(userId);
      var manageLink = base + '?action=manage&uid=' + encodeURIComponent(userId);
      replyText_(ev.replyToken,
        '歡迎！\n➕ 新增租屋通知條件：\n' + addLink + '\n\n📋 查看/管理我的訂閱：\n' + manageLink);
    }
  });
  return json_({ ok: true });
}

function replyText_(replyToken, text) {
  if (!replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}
