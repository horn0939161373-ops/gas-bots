// ============================================================
// line.js ─ 用 LINE Messaging API 推播新物件卡片
// ============================================================

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// LINE 的 image/uri 元件都要求合法的 https:// 網址；591 頁面上抓到的
// <img> src 常常是相對路徑、data URI 或懶載入用的空白圖，直接塞進去
// 會讓整則訊息被 LINE API 判定為 400 invalid（曾經因此整批推播失敗）。
function isValidHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/.test(url) && url.length <= 1000;
}

function buildBubble(item) {
  const bodyContents = [];
  if (isValidHttpUrl(item.cover)) {
    bodyContents.push({ type: 'image', url: item.cover, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' });
  }
  bodyContents.push({
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
    contents: [
      { type: 'text', text: String(item.title || '未命名物件').slice(0, 200), weight: 'bold', size: 'sm', wrap: true },
      {
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: '租金', color: '#475569', size: 'xs', flex: 2 },
          { type: 'text', text: `$${item.price}`, weight: 'bold', size: 'xs', align: 'end', color: '#DC2626', flex: 3 }
        ]
      }
    ]
  });

  const detailUri = isValidHttpUrl(item.url) ? item.url : 'https://rent.591.com.tw/';

  return {
    type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', contents: bodyContents },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{
        type: 'button', style: 'primary', color: '#0F766E', height: 'sm',
        action: { type: 'uri', label: '查看物件詳情', uri: detailUri }
      }]
    }
  };
}

async function pushNewListings(items) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;
  if (!token || !targetId) {
    throw new Error('尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_TARGET_ID 環境變數');
  }

  const bubbles = items.slice(0, 10).map(buildBubble);
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      to: targetId,
      messages: [{
        type: 'flex',
        altText: `🏠 找到 ${items.length} 筆新物件！`,
        contents: { type: 'carousel', contents: bubbles }
      }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE push 失敗: ${res.status} ${text.slice(0, 300)}`);
  }
}

module.exports = { pushNewListings };
