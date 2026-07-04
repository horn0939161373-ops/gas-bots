/**
 * 591 多人訂閱 ─ Google Apps Script Web App
 * ------------------------------------------------------------
 * 一支 GAS 同時扮演三個角色：
 *   1. 網頁表單：使用者選自己的租屋條件（doGet 回傳 Index.html）
 *   2. LINE webhook：使用者加官方帳號好友時，取得他的 userId，並回一則
 *      「設定你的條件」連結（doPost）
 *   3. 給 GitHub Actions 讀訂閱清單的 JSON 端點（doGet?action=list&token=）
 *
 * 資料存在同一份試算表的 "subscriptions" 工作表。
 *
 * 需要在「專案設定 → 指令碼屬性」設定：
 *   LINE_CHANNEL_ACCESS_TOKEN  你的 LINE OA channel access token（回覆用）
 *   API_TOKEN                  自訂的一組隨機字串，Actions 讀清單時要帶，避免被亂讀
 *   SPREADSHEET_ID             存訂閱的 Google 試算表 ID（網址中 /d/ 後那段）
 */

var SHEET_NAME = 'subscriptions';
var HEADERS = ['userId', 'name', 'region', 'district', 'priceMin', 'priceMax',
  'roomType', 'keyword', 'maxResults', 'balcony', 'elevator', 'pet',
  'airConditioner', 'cooking', 'enabled', 'updatedAt'];

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
  return sh;
}

// ── 網頁 / JSON 端點 ─────────────────────────────────────────
function doGet(e) {
  var params = (e && e.parameter) || {};
  // GitHub Actions 讀訂閱清單：/exec?action=list&token=API_TOKEN
  if (params.action === 'list') {
    if (params.token !== prop('API_TOKEN')) {
      return json_({ error: 'unauthorized' });
    }
    return json_(readSubscriptions_());
  }
  // 否則回傳設定表單，帶入 uid（從 LINE 連結點進來時會有）
  var t = HtmlService.createTemplateFromFile('Index');
  t.uid = params.uid || '';
  return t.evaluate()
    .setTitle('591 租屋條件設定')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readSubscriptions_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var c = 0; c < header.length; c++) obj[header[c]] = row[c];
    if (!obj.userId) continue;
    // 型別整理
    obj.priceMin = Number(obj.priceMin) || 0;
    obj.priceMax = Number(obj.priceMax) || 0;
    obj.maxResults = Number(obj.maxResults) || 10;
    ['balcony', 'elevator', 'pet', 'airConditioner', 'cooking'].forEach(function (k) {
      obj[k] = obj[k] === true || obj[k] === 'TRUE' || obj[k] === 'true' || obj[k] === 1;
    });
    obj.enabled = !(obj.enabled === false || obj.enabled === 'FALSE' || obj.enabled === 'false');
    out.push(obj);
  }
  return out;
}

// ── 表單送出（前端用 google.script.run 呼叫）──────────────────
function saveSubscription(data) {
  if (!data || !data.userId) throw new Error('缺少 userId');
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === data.userId) { rowIndex = i + 1; break; }
  }
  var record = [
    data.userId, data.name || '', data.region || '', data.district || '',
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
  return { ok: true };
}

// ── LINE webhook：加好友時取得 userId 並回覆設定連結 ────────────
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var events = body.events || [];
  var webAppUrl = ScriptApp.getService().getUrl();
  events.forEach(function (ev) {
    var userId = ev.source && ev.source.userId;
    if (!userId) return;
    // follow（加好友）或傳任何訊息，都回一則「設定條件」連結
    if (ev.type === 'follow' || ev.type === 'message') {
      var link = webAppUrl + '?uid=' + encodeURIComponent(userId);
      replyText_(ev.replyToken, '歡迎！點這裡設定你的租屋通知條件：\n' + link);
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
