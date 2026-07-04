// ============================================================
// line.js ─ 用 LINE Messaging API 推播新物件卡片
// ============================================================

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// LINE 一則 flex carousel 最多 10 個 bubble，一次 push 呼叫最多 5 則訊息，
// 所以一次 push() 呼叫最多能塞 10*5=50 筆；超過就分成多次 push() 呼叫。
const MAX_BUBBLES_PER_CAROUSEL = 10;
const MAX_MESSAGES_PER_PUSH = 5;

// 抓不到合法圖片時的備用圖，確保每張卡片都有圖片可以顯示。
const FALLBACK_IMAGE = 'https://placehold.co/600x400/0F766E/FFFFFF?text=591+%E7%A7%9F%E5%B1%8B';

// LINE 的 image/uri 元件都要求合法的 https:// 網址；591 頁面上抓到的
// <img> src 常常是相對路徑、data URI 或懶載入用的空白圖，直接塞進去
// 會讓整則訊息被 LINE API 判定為 400 invalid（曾經因此整批推播失敗）。
function isValidHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/.test(url) && url.length <= 1000;
}

function buildBubble(item) {
  const coverUrl = isValidHttpUrl(item.cover) ? item.cover : FALLBACK_IMAGE;
  const bodyContents = [
    { type: 'image', url: coverUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
    {
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
    }
  ];

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendPush(token, targetId, messages) {
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ to: targetId, messages })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE push 失敗: ${res.status} ${text.slice(0, 300)}`);
  }
}

// 把一批物件組成 flex carousel 訊息（自動分批：一則最多 10 bubble）。
function buildCarouselMessages(items) {
  const carouselGroups = chunk(items, MAX_BUBBLES_PER_CAROUSEL);
  return carouselGroups.map((group, idx) => ({
    type: 'flex',
    altText: `🏠 新物件通知（第 ${idx + 1}/${carouselGroups.length} 批，共 ${items.length} 筆）`,
    contents: { type: 'carousel', contents: group.map(buildBubble) }
  }));
}

/** 推播一批物件給「指定的」LINE 對象（多人版用，一次 push 最多 5 則訊息） */
async function pushListingsToTarget(token, targetId, items) {
  if (!items.length) return;
  const messages = buildCarouselMessages(items);
  const pushBatches = chunk(messages, MAX_MESSAGES_PER_PUSH);
  for (const batch of pushBatches) {
    await sendPush(token, targetId, batch);
  }
}

/** 單人版：推播給環境變數指定的預設對象（不限制筆數，自動分批） */
async function pushNewListings(items) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targetId = process.env.LINE_TARGET_ID;
  if (!token || !targetId) {
    throw new Error('尚未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_TARGET_ID 環境變數');
  }
  await pushListingsToTarget(token, targetId, items);
}

module.exports = { pushNewListings, pushListingsToTarget };
