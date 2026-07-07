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

// 縣市 → 行政區 → 591 section 代碼。全台完整清單，直接從 591 官方前端
// 設定檔傾印（見 notify-bot/scripts/dump-districts.js 與 Actions 的
// 「傾印 591 行政區代碼表」workflow），日後 591 若調整代碼照樣重跑一次
// 再貼進來即可。
var DISTRICTS_BY_REGION = {
  '台北市': [
    ['中正區', 1], ['大同區', 2], ['中山區', 3], ['松山區', 4], ['大安區', 5],
    ['萬華區', 6], ['信義區', 7], ['士林區', 8], ['北投區', 9], ['內湖區', 10],
    ['南港區', 11], ['文山區', 12]
  ],
  '基隆市': [
    ['仁愛區', 13], ['信義區', 14], ['中正區', 15], ['中山區', 16], ['安樂區', 17],
    ['暖暖區', 18], ['七堵區', 19]
  ],
  '新北市': [
    ['萬里區', 20], ['金山區', 21], ['板橋區', 26], ['汐止區', 27], ['深坑區', 28],
    ['石碇區', 29], ['瑞芳區', 30], ['平溪區', 31], ['雙溪區', 32], ['貢寮區', 33],
    ['新店區', 34], ['坪林區', 35], ['烏來區', 36], ['永和區', 37], ['中和區', 38],
    ['土城區', 39], ['三峽區', 40], ['樹林區', 41], ['鶯歌區', 42], ['三重區', 43],
    ['新莊區', 44], ['泰山區', 45], ['林口區', 46], ['蘆洲區', 47], ['五股區', 48],
    ['八里區', 49], ['淡水區', 50], ['三芝區', 51], ['石門區', 52]
  ],
  '新竹市': [
    ['香山區', 370], ['東區', 371], ['北區', 372]
  ],
  '新竹縣': [
    ['竹北市', 54], ['湖口鄉', 55], ['新豐鄉', 56], ['新埔鎮', 57], ['關西鎮', 58],
    ['芎林鄉', 59], ['寶山鄉', 60], ['竹東鎮', 61], ['五峰鄉', 62], ['橫山鄉', 63],
    ['尖石鄉', 64], ['北埔鄉', 65], ['峨嵋鄉', 66]
  ],
  '桃園市': [
    ['中壢區', 67], ['平鎮區', 68], ['龍潭區', 69], ['楊梅區', 70], ['新屋區', 71],
    ['觀音區', 72], ['桃園區', 73], ['龜山區', 74], ['八德區', 75], ['大溪區', 76],
    ['復興區', 77], ['大園區', 78], ['蘆竹區', 79]
  ],
  '苗栗縣': [
    ['竹南鎮', 80], ['頭份市', 81], ['三灣鄉', 82], ['南庄鄉', 83], ['獅潭鄉', 84],
    ['後龍鎮', 85], ['通霄鎮', 86], ['苑裡鎮', 87], ['苗栗市', 88], ['造橋鄉', 89],
    ['頭屋鄉', 90], ['公館鄉', 91], ['大湖鄉', 92], ['泰安鄉', 93], ['銅鑼鄉', 94],
    ['三義鄉', 95], ['西湖鄉', 96], ['卓蘭鎮', 97]
  ],
  '台中市': [
    ['中區', 98], ['東區', 99], ['南區', 100], ['西區', 101], ['北區', 102],
    ['北屯區', 103], ['西屯區', 104], ['南屯區', 105], ['太平區', 106], ['大里區', 107],
    ['霧峰區', 108], ['烏日區', 109], ['豐原區', 110], ['后里區', 111], ['石岡區', 112],
    ['東勢區', 113], ['和平區', 114], ['新社區', 115], ['潭子區', 116], ['大雅區', 117],
    ['神岡區', 118], ['大肚區', 119], ['沙鹿區', 120], ['龍井區', 121], ['梧棲區', 122],
    ['清水區', 123], ['大甲區', 124], ['外埔區', 125], ['大安區', 126]
  ],
  '彰化縣': [
    ['彰化市', 127], ['芬園鄉', 128], ['花壇鄉', 129], ['秀水鄉', 130], ['鹿港鎮', 131],
    ['福興鄉', 132], ['線西鄉', 133], ['和美鎮', 134], ['伸港鄉', 135], ['員林市', 136],
    ['社頭鄉', 137], ['永靖鄉', 138], ['埔心鄉', 139], ['溪湖鎮', 140], ['大村鄉', 141],
    ['埔鹽鄉', 142], ['田中鎮', 143], ['北斗鎮', 144], ['田尾鄉', 145], ['埤頭鄉', 146],
    ['溪州鄉', 147], ['竹塘鄉', 148], ['二林鎮', 149], ['大城鄉', 150], ['芳苑鄉', 151],
    ['二水鄉', 152]
  ],
  '南投縣': [
    ['南投市', 153], ['中寮鄉', 154], ['草屯鎮', 155], ['國姓鄉', 156], ['埔里鎮', 157],
    ['仁愛鄉', 158], ['名間鄉', 159], ['集集鎮', 160], ['水里鄉', 161], ['魚池鄉', 162],
    ['信義鄉', 163], ['竹山鎮', 164], ['鹿谷鄉', 165]
  ],
  '嘉義縣': [
    ['番路鄉', 167], ['梅山鄉', 168], ['竹崎鄉', 169], ['阿里山鄉', 170], ['中埔鄉', 171],
    ['大埔鄉', 172], ['水上鄉', 173], ['鹿草鄉', 174], ['太保市', 175], ['朴子市', 176],
    ['東石鄉', 177], ['六腳鄉', 178], ['新港鄉', 179], ['民雄鄉', 180], ['大林鎮', 181],
    ['溪口鄉', 182], ['義竹鄉', 183], ['布袋鎮', 184]
  ],
  '雲林縣': [
    ['斗南鎮', 185], ['大埤鄉', 186], ['虎尾鎮', 187], ['土庫鎮', 188], ['褒忠鄉', 189],
    ['東勢鄉', 190], ['臺西鄉', 191], ['崙背鄉', 192], ['麥寮鄉', 193], ['斗六市', 194],
    ['林內鄉', 195], ['古坑鄉', 196], ['莿桐鄉', 197], ['西螺鎮', 198], ['二崙鄉', 199],
    ['北港鎮', 200], ['水林鄉', 201], ['口湖鄉', 202], ['四湖鄉', 203], ['元長鄉', 204]
  ],
  '台南市': [
    ['東區', 206], ['南區', 207], ['中西區', 208], ['北區', 209], ['安平區', 210],
    ['安南區', 211], ['永康區', 212], ['歸仁區', 213], ['新化區', 214], ['左鎮區', 215],
    ['玉井區', 216], ['楠西區', 217], ['南化區', 218], ['仁德區', 219], ['關廟區', 220],
    ['龍崎區', 221], ['官田區', 222], ['麻豆區', 223], ['佳里區', 224], ['西港區', 225],
    ['七股區', 226], ['將軍區', 227], ['學甲區', 228], ['北門區', 229], ['新營區', 230],
    ['後壁區', 231], ['白河區', 232], ['東山區', 233], ['六甲區', 234], ['下營區', 235],
    ['柳營區', 236], ['鹽水區', 237], ['善化區', 238], ['大內區', 239], ['山上區', 240],
    ['新市區', 241], ['安定區', 242]
  ],
  '高雄市': [
    ['新興區', 243], ['前金區', 244], ['苓雅區', 245], ['鹽埕區', 246], ['鼓山區', 247],
    ['旗津區', 248], ['前鎮區', 249], ['三民區', 250], ['楠梓區', 251], ['小港區', 252],
    ['左營區', 253], ['仁武區', 254], ['大社區', 255], ['岡山區', 258], ['路竹區', 259],
    ['阿蓮區', 260], ['田寮區', 261], ['燕巢區', 262], ['橋頭區', 263], ['梓官區', 264],
    ['彌陀區', 265], ['永安區', 266], ['湖內區', 267], ['鳳山區', 268], ['大寮區', 269],
    ['林園區', 270], ['鳥松區', 271], ['大樹區', 272], ['旗山區', 273], ['美濃區', 274],
    ['六龜區', 275], ['內門區', 276], ['杉林區', 277], ['甲仙區', 278], ['桃源區', 279],
    ['那瑪夏區', 280], ['茂林區', 281], ['茄萣區', 282]
  ],
  '屏東縣': [
    ['屏東市', 295], ['三地門鄉', 296], ['霧臺鄉', 297], ['瑪家鄉', 298], ['九如鄉', 299],
    ['里港鄉', 300], ['高樹鄉', 301], ['鹽埔鄉', 302], ['長治鄉', 303], ['麟洛鄉', 304],
    ['竹田鄉', 305], ['內埔鄉', 306], ['萬丹鄉', 307], ['潮州鎮', 308], ['泰武鄉', 309],
    ['來義鄉', 310], ['萬巒鄉', 311], ['崁頂鄉', 312], ['新埤鄉', 313], ['南州鄉', 314],
    ['林邊鄉', 315], ['東港鎮', 316], ['琉球鄉', 317], ['佳冬鄉', 318], ['新園鄉', 319],
    ['枋寮鄉', 320], ['枋山鄉', 321], ['春日鄉', 322], ['獅子鄉', 323], ['車城鄉', 324],
    ['牡丹鄉', 325], ['恆春鎮', 326], ['滿州鄉', 327]
  ],
  '宜蘭縣': [
    ['宜蘭市', 328], ['頭城鎮', 329], ['礁溪鄉', 330], ['壯圍鄉', 331], ['員山鄉', 332],
    ['羅東鎮', 333], ['三星鄉', 334], ['大同鄉', 335], ['五結鄉', 336], ['冬山鄉', 337],
    ['蘇澳鎮', 338], ['南澳鄉', 339]
  ],
  '台東縣': [
    ['臺東市', 341], ['綠島鄉', 342], ['蘭嶼鄉', 343], ['延平鄉', 344], ['卑南鄉', 345],
    ['鹿野鄉', 346], ['關山鎮', 347], ['海端鄉', 348], ['池上鄉', 349], ['東河鄉', 350],
    ['成功鎮', 351], ['長濱鄉', 352], ['太麻里鄉', 353], ['金峰鄉', 354], ['大武鄉', 355],
    ['達仁鄉', 356]
  ],
  '花蓮縣': [
    ['花蓮市', 357], ['新城鄉', 358], ['秀林鄉', 359], ['吉安鄉', 360], ['壽豐鄉', 361],
    ['鳳林鎮', 362], ['光復鄉', 363], ['豐濱鄉', 364], ['瑞穗鄉', 365], ['萬榮鄉', 366],
    ['玉里鎮', 367], ['卓溪鄉', 368], ['富里鄉', 369]
  ],
  '澎湖縣': [
    ['馬公市', 283], ['西嶼鄉', 284], ['望安鄉', 285], ['七美鄉', 286], ['白沙鄉', 287],
    ['湖西鄉', 288]
  ],
  '金門縣': [
    ['金沙鎮', 289], ['金湖鎮', 290], ['金寧鄉', 291], ['金城鎮', 292], ['烈嶼鄉', 293],
    ['烏坵鄉', 294]
  ],
  '連江縣': [
    ['南竿鄉', 22], ['北竿鄉', 23], ['莒光鄉', 24], ['東引鄉', 25]
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

  // GAS 網頁實際是在 googleusercontent.com 的沙盒網域裡執行，頁面裡的
  // 「相對連結」（?action=manage 這種）會解析到沙盒網域而不是 /exec，
  // 點了會直接壞掉。所以所有頁面間跳轉的連結都要用完整的 exec 網址。
  var baseUrl = ScriptApp.getService().getUrl();

  if (params.action === 'manage') {
    var t = HtmlService.createTemplateFromFile('Manage');
    t.uid = params.uid || '';
    t.baseUrl = baseUrl;
    t.districtsJson = JSON.stringify(DISTRICTS_BY_REGION);
    return t.evaluate().setTitle('我的 591 訂閱')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 預設：新增/編輯表單
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.uid = params.uid || '';
  tpl.subId = params.subId || '';
  tpl.baseUrl = baseUrl;
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
