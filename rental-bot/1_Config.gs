// ============================================================
// 1_Config.gs ─ 全域常數、LINE API 工具、共用函式
// ============================================================

function getChannelAccessToken() {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if (!token) throw new Error('尚未設定 Script Properties 的 LINE_TOKEN，請至 GAS 專案設定。');
  return token;
}

// ─── LINE API 工具 ────────────────────────────────────────────

function replyTextMessage(replyToken, text) {
  return sendReply(replyToken, [{ type: "text", text }]);
}
function replyFlexMessage(replyToken, altText, flexContents) {
  return sendReply(replyToken, [{ type: "flex", altText, contents: flexContents }]);
}
function sendReply(replyToken, messages) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({ replyToken, messages }),
    muteHttpExceptions: true
  });
}
function pushFlexToLine(userId, flexContent, altText) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: "flex", altText: altText || "591 租屋通知", contents: flexContent }]
    }),
    muteHttpExceptions: true
  });
}
function sendLoadingAnimation(userId, seconds) {
  seconds = Math.min(Math.max(seconds || 5, 5), 60);
  UrlFetchApp.fetch("https://api.line.me/v2/bot/chat/loading/start", {
    method: "post",
    headers: { "Content-Type": "application/json",
               "Authorization": "Bearer " + getChannelAccessToken() },
    payload: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
    muteHttpExceptions: true
  });
}

// ─── Sheet 存取 ───────────────────────────────────────────────

/** 取得指定分頁，不存在則自動建立並寫入表頭 */
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─── 共用工具 ─────────────────────────────────────────────────

function nowTimestamp() {
  return Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss");
}
