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
 *   SPREADSHEET_ID             （選填）存訂閱的試算表 ID；用「試算表 擴充功能
 *                              → Apps Script」建立的綁定式指令碼可不填，會自動
 *                              用綁定的那份試算表
 */

var SHEET_NAME = 'subscriptions';
var HEADERS = ['subId', 'userId', 'name', 'region', 'district', 'priceMin', 'priceMax',
  'roomType', 'keyword', 'maxResults', 'balcony', 'elevator', 'pet',
  'airConditioner', 'cooking', 'enabled', 'updatedAt'];

// 縣市 → 行政區 → 591 section 代碼。目前只有高雄是逐一核對過的；其他縣市
// 之後補進來即可（補一個城市 = 加一個陣列）。沒列在這裡的縣市，表單會退回
// 讓使用者手動輸入行政區名稱或代碼。
// 代碼皆取自實際 591 網址（rent.591.com.tw/list?region=&section=）。台北、高雄
// 為完整清單；新北/桃園/台中/台南先放主要行政區，其餘可用表單的「其他行政區
// （手動）」欄補代碼。要補齊某城市時，照樣從 591 網址抓 section= 加進來即可。
var DISTRICTS_BY_REGION = {
  '台北市': [
    ['中正區', 1], ['大同區', 2], ['中山區', 3], ['松山區', 4], ['大安區', 5],
    ['萬華區', 6], ['信義區', 7], ['士林區', 8], ['北投區', 9], ['內湖區', 10],
    ['南港區', 11], ['文山區', 12]
  ],
  '新北市': [
    ['板橋區', 26], ['新店區', 34], ['中和區', 38], ['土城區', 39], ['樹林區', 41],
    ['三重區', 43], ['新莊區', 44]
  ],
  '桃園市': [
    ['中壢區', 67], ['桃園區', 73], ['龜山區', 74], ['八德區', 75], ['大溪區', 76]
  ],
  '台中市': [
    ['中區', 98], ['北區', 102], ['北屯區', 103], ['西屯區', 104], ['南屯區', 105],
    ['大里區', 117]
  ],
  '台南市': [
    ['南區', 207], ['中西區', 208], ['北區', 209], ['安南區', 211], ['歸仁區', 213],
    ['新營區', 230], ['六甲區', 234], ['新市區', 241]
  ],
  '高雄市': [
    ['新興區', 243], ['前金區', 244], ['苓雅區', 245], ['鹽埕區', 246],
    ['鼓山區', 247], ['前鎮區', 249], ['三民區', 250], ['楠梓區', 251],
    ['左營區', 253], ['鳳山區', 268]
  ]
};

function prop(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// 取得試算表：有設 SPREADSHEET_ID 就用它（獨立式指令碼）；沒設就用「綁定
// 的這份試算表」（從試算表 擴充功能 → Apps Script 建的容器綁定式指令碼）。
function getSpreadsheet_() {
  var id = prop('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('找不到試算表：請用「試算表 擴充功能 → Apps Script」建立，或設定 SPREADSHEET_ID 指令碼屬性');
  return ss;
}

function getSheet_() {
  var ss = getSpreadsheet_();
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
  // district 欄一定要是「純文字」格式：不然「244,245,246,247」這種逗號
  // 分隔的代碼會被試算表當成千分位數字轉成 244245246247，送給 591 就
  // 查不到任何物件（實際發生過，通知因此完全中斷）。
  var dCol = HEADERS.indexOf('district') + 1;
  sh.getRange(1, dCol, sh.getMaxRows(), 1).setNumberFormat('@');
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
  // 編輯既有訂閱時保留原本的 enabled 狀態：不然編輯一筆「已暫停」的訂閱
  // 會被無聲地重新啟用。新訂閱才預設啟用。
  var enabled = true;
  if (rowIndex > 0) {
    var prev = values[rowIndex - 1][HEADERS.indexOf('enabled')];
    enabled = !(prev === false || prev === 'FALSE' || prev === 'false');
  }
  var record = [
    subId, data.userId, data.name || '', data.region || '', data.district || '',
    Number(data.priceMin) || 0, Number(data.priceMax) || 0,
    data.roomType || '不限', data.keyword || '', Number(data.maxResults) || 10,
    !!data.balcony, !!data.elevator, !!data.pet, !!data.airConditioner, !!data.cooking,
    enabled, new Date().toISOString()
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
