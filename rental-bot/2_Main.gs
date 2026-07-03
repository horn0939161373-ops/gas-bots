// ============================================================
// 2_Main.gs ─ LINE Webhook 入口
// ============================================================

function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(3000); } catch (f) {
    return ContentService.createTextOutput("OK");
  }
  try {
    if (!e || !e.postData) return ContentService.createTextOutput("OK");
    const event = JSON.parse(e.postData.contents).events[0];
    if (!event) return ContentService.createTextOutput("OK");

    const replyToken = event.replyToken;
    const userId = event.source && event.source.userId;

    if (event.type === "follow") {
      replyFlexMessage(replyToken, "591 租屋通知小幫手", FlexMessage.getWelcomeCard());
      return ContentService.createTextOutput("OK");
    }
    if (event.type === "message" && event.message.type === "text") {
      handleTextMessage(replyToken, userId, event.message.text.trim());
      return ContentService.createTextOutput("OK");
    }
    if (event.type === "postback") {
      handlePostback(replyToken, userId, event.postback);
    }
  } catch (err) {
    Logger.log("doPost 錯誤: " + err.stack);
    try {
      const rt = JSON.parse(e.postData.contents).events[0].replyToken;
      replyTextMessage(rt, "⚠️ 系統發生錯誤，請稍後再試。");
    } catch (e2) {}
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput("OK");
}

// ─── 文字訊息 ─────────────────────────────────────────────────

function handleTextMessage(replyToken, userId, msg) {
  // 篩選條件設定精靈進行中 → 優先處理文字輸入
  const session = getSession(userId);
  if (session && session.step) {
    handleWizardTextInput(replyToken, userId, session, msg);
    return;
  }

  switch (msg) {
    case "選單":
    case "menu":
      replyFlexMessage(replyToken, "591 租屋通知選單", FlexMessage.getMenuCard());
      break;

    case "我的條件":
      handleShowFilter(replyToken, userId);
      break;

    case "立即查詢":
      sendLoadingAnimation(userId, 10);
      handleManualSearch(replyToken, userId);
      break;

    case "說明":
      replyTextMessage(replyToken,
        "💡 【591 租屋通知使用說明】\n\n" +
        "1.【選單】開啟主選單\n" +
        "2.【設定篩選條件】依步驟設定地區/價格/房型/關鍵字/設備\n" +
        "3.【我的條件】查看目前設定\n" +
        "4.【立即查詢】用目前條件查一次\n" +
        "5.【開啟/關閉通知】控制是否定時推播新物件");
      break;

    default:
      replyTextMessage(replyToken, "請輸入「選單」開始設定 591 租屋通知條件喔！");
  }
}

// ─── Postback ─────────────────────────────────────────────────

function handlePostback(replyToken, userId, postback) {
  const p = {};
  (postback.data || "").split("&").forEach(kv => {
    const [k, v] = kv.split("=");
    p[k] = decodeURIComponent(v || "");
  });
  const action = p.action;

  if (action === "start_wizard") {
    startFilterWizard(userId);
    replyTextMessage(replyToken,
      "🏠 開始設定篩選條件！\n\n請輸入想找房的縣市（例如：台北市、新北市），或直接輸入 591 的 region 數字代碼。");
    return;
  }

  if (action === "wizard_pick_kind") {
    handleWizardPickKind(replyToken, userId, p.kind);
    return;
  }

  if (action === "wizard_toggle_facility") {
    handleWizardToggleFacility(replyToken, userId, p.facility);
    return;
  }

  if (action === "wizard_finish_facility") {
    finishWizardAndSave(replyToken, userId);
    return;
  }

  if (action === "toggle_push") {
    const enabled = setPushEnabled(userId, p.enabled === "1");
    replyTextMessage(replyToken, enabled ? "🔔 已開啟每日新物件通知！" : "🔕 已關閉通知。");
    return;
  }
}
