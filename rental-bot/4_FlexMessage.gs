// ============================================================
// 4_FlexMessage.gs ─ Flex 訊息組裝工廠
// ============================================================

const FlexMessage = {

  // ─── 歡迎卡 ────────────────────────────────────────────────
  getWelcomeCard: function () {
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F766E", contents: [
        { type: "text", text: "🏠 591 租屋通知小幫手", weight: "bold", size: "md", color: "#ffffff" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: "設定好你想要的地區、預算、房型與設備後，有新物件上架就會馬上通知你！",
          wrap: true, size: "sm", color: "#334155" }
      ]},
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "button", style: "primary", color: "#0F766E", height: "sm",
          action: { type: "postback", label: "🔍 開始設定篩選條件", data: "action=start_wizard" }}
      ]}
    };
  },

  // ─── 主選單 ────────────────────────────────────────────────
  getMenuCard: function () {
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F766E", contents: [
        { type: "text", text: "📋 591 租屋通知選單", weight: "bold", size: "md", color: "#ffffff" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "text", text: "請選擇操作項目：", size: "sm", color: "#334155" }
      ]},
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "button", style: "primary", color: "#0F766E", height: "sm",
          action: { type: "postback", label: "🔍 設定篩選條件", data: "action=start_wizard" }},
        { type: "button", style: "secondary", height: "sm",
          action: { type: "message", label: "📋 我的條件", text: "我的條件" }},
        { type: "button", style: "secondary", height: "sm",
          action: { type: "message", label: "🏠 立即查詢", text: "立即查詢" }},
        { type: "box", layout: "horizontal", spacing: "xs", contents: [
          { type: "button", style: "secondary", color: "#059669", height: "sm", flex: 1,
            action: { type: "postback", label: "🔔 開啟通知", data: "action=toggle_push&enabled=1" }},
          { type: "button", style: "secondary", color: "#DC2626", height: "sm", flex: 1,
            action: { type: "postback", label: "🔕 關閉通知", data: "action=toggle_push&enabled=0" }}
        ]}
      ]}
    };
  },

  // ─── 房型選擇 ──────────────────────────────────────────────
  getKindPickerCard: function () {
    const kinds = [["1","整層住家"],["2","獨立套房"],["3","分租套房"],["4","雅房"],["5","別墅"],["0","不限"]];
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F766E", contents: [
        { type: "text", text: "🏠 請選擇房型", weight: "bold", size: "md", color: "#ffffff" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm",
        contents: kinds.map(([code, label]) => ({
          type: "button", style: "secondary", height: "sm",
          action: { type: "postback", label, data: `action=wizard_pick_kind&kind=${code}` }
        }))
      }
    };
  },

  // ─── 設備複選 ──────────────────────────────────────────────
  getFacilityPickerCard: function (selected) {
    const facilities = [["cold","冷氣"],["balcony_1","陽台"],["lift","電梯"],["pet","可養寵物"],["cook","可開伙"]];
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F766E", contents: [
        { type: "text", text: "✅ 選擇想要的設備（可複選）", weight: "bold", size: "sm", color: "#ffffff", wrap: true }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm",
        contents: facilities.map(([code, label]) => ({
          type: "button",
          style: selected.includes(code) ? "primary" : "secondary",
          color: selected.includes(code) ? "#0F766E" : undefined,
          height: "sm",
          action: { type: "postback", label: (selected.includes(code) ? "✓ " : "") + label,
            data: `action=wizard_toggle_facility&facility=${code}` }
        }))
      },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", color: "#F59E0B", height: "sm",
          action: { type: "postback", label: "✅ 完成設定", data: "action=wizard_finish_facility" }}
      ]}
    };
  },

  // ─── 條件摘要卡 ────────────────────────────────────────────
  getFilterSummaryCard: function (f, showTip) {
    if (!f) {
      return { type: "bubble", body: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "尚未設定任何篩選條件，請輸入「選單」開始設定。", wrap: true, size: "sm" }
      ]}};
    }
    const priceText = (f.priceMin || f.priceMax) ? `$${f.priceMin} - $${f.priceMax}` : "不限";
    return {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#0F766E", contents: [
        { type: "text", text: "📋 目前篩選條件", weight: "bold", size: "md", color: "#ffffff" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        this._row("地區代碼", f.region),
        this._row("租金區間", priceText),
        this._row("房型", KIND_MAP[f.kind] || "不限"),
        this._row("關鍵字", f.keyword || "無"),
        this._row("設備", f.facilities.length ? f.facilities.join(", ") : "無"),
        this._row("通知狀態", f.pushEnabled ? "🔔 已開啟" : "🔕 已關閉"),
        ...(showTip ? [{ type: "text", text: "系統將定時查詢並推播新上架的物件！",
          wrap: true, size: "xs", color: "#64748B", margin: "md" }] : [])
      ]}
    };
  },

  // ─── 物件卡（搜尋結果 / 通知共用） ──────────────────────────
  buildListingBubble: function (item) {
    const contents = [];
    if (item.cover) {
      contents.push({ type: "image", url: item.cover, size: "full", aspectRatio: "20:13", aspectMode: "cover" });
    }
    contents.push({ type: "box", layout: "vertical", spacing: "sm", paddingAll: "md", contents: [
      { type: "text", text: item.title, weight: "bold", size: "sm", wrap: true },
      FlexMessage._row("租金", `$${item.price} /${item.priceUnit || "月"}`, "#DC2626"),
      FlexMessage._row("房型", item.kind || "-"),
      FlexMessage._row("坪數", item.area || "-"),
      FlexMessage._row("樓層", item.floor || "-"),
      FlexMessage._row("區域", item.region || "-")
    ]});
    return {
      type: "bubble", size: "mega",
      body: { type: "box", layout: "vertical", contents },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", color: "#0F766E", height: "sm",
          action: { type: "uri", label: "查看物件詳情", uri: item.url }}
      ]}
    };
  },

  // ─── 共用方法 ─────────────────────────────────────────────
  _row: function (label, value, valueColor) {
    const v = { type: "text", text: String(value), weight: "bold", size: "xs", align: "end", wrap: true, flex: 3 };
    if (valueColor) v.color = valueColor;
    return { type: "box", layout: "horizontal",
      contents: [{ type: "text", text: label, color: "#475569", size: "xs", flex: 2 }, v] };
  }
};

// ─── 文字指令處理（查條件 / 立即查詢） ─────────────────────────

function handleShowFilter(replyToken, userId) {
  const f = getUserFilter(userId);
  replyFlexMessage(replyToken, "我的篩選條件", FlexMessage.getFilterSummaryCard(f, false));
}

function handleManualSearch(replyToken, userId) {
  const f = getUserFilter(userId);
  if (!f) {
    replyTextMessage(replyToken, "尚未設定篩選條件，請先輸入「選單」進行設定。");
    return;
  }
  let listings;
  try {
    listings = fetchListings591(f, 0);
  } catch (e) {
    Logger.log("❌ handleManualSearch: " + e.stack);
    replyTextMessage(replyToken, "⚠️ 查詢 591 時發生錯誤，請稍後再試。");
    return;
  }
  if (!listings.length) {
    replyTextMessage(replyToken, "目前找不到符合條件的物件，稍後系統會持續為你監控新上架物件！");
    return;
  }
  const bubbles = listings.slice(0, 10).map(FlexMessage.buildListingBubble);
  replyFlexMessage(replyToken, `目前找到 ${listings.length} 筆物件`, { type: "carousel", contents: bubbles });
}
