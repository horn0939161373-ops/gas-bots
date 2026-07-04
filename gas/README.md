# 多人版部署指南（GAS 表單 + LINE + Google 試算表）

這個資料夾是「多人自助訂閱」的前端:一支 Google Apps Script（GAS）Web App，
同時當①網頁表單②LINE webhook③給 GitHub Actions 讀訂閱清單的 JSON 端點。
資料存在一份 Google 試算表。

> ⚠️ 這些步驟綁你自己的 Google / LINE 帳號，只能你本人操作（無法代勞）。
> 抓取仍然跑在 GitHub Actions（Playwright），GAS 不負責抓 591。

## 前提限制
- **只能推播給「已加你 LINE 官方帳號好友」的人**，所以流程從加好友開始。
- **LINE 免費推播每月約 200 則**，人多會不夠，屆時要升級 LINE 方案。

## 步驟

### A. 建 Google 試算表
1. sheets.google.com 建一個空白試算表。
2. 記下它的 ID：網址 `.../spreadsheets/d/【ID】/edit`。

### B. 建 GAS 專案、貼程式
1. script.google.com → 新增專案。
2. 把 `gas/Code.gs` 內容貼進預設的「程式碼.gs」。
3. 左側 **+ → HTML**，命名 **`Index`**，貼入 `gas/Index.html`。
4. 齒輪 **專案設定 → 指令碼屬性**，新增三個：
   - `SPREADSHEET_ID` = A 的試算表 ID
   - `LINE_CHANNEL_ACCESS_TOKEN` = 你的 LINE OA channel access token
   - `API_TOKEN` = 自訂一串亂數（GitHub secret 要用同一串）

### C. 部署成 Web App
1. 右上 **部署 → 新增部署作業 → 網頁應用程式**。
2. 執行身分：**我**；存取權：**任何人**。
3. 部署 → 授權 → 複製 **exec 網址**（`.../exec` 結尾）。

### D. 接 LINE webhook
1. LINE Developers → 你的 Messaging API channel → **Messaging API** 頁籤。
2. **Webhook URL** 填 C 的 exec 網址，開啟 **Use webhook**。
3. **關閉**「自動回覆訊息」（Auto-reply）。

### E. 設 GitHub Secret
repo → Settings → Secrets and variables → Actions → 新增：
- `SUBSCRIPTIONS_URL` = `你的exec網址?action=list&token=你的API_TOKEN`

（`LINE_CHANNEL_ACCESS_TOKEN` 已在單人版設過，不用重設。）

### F. 測試
1. 手機 LINE 加你官方帳號好友 → 應收到「點這裡設定條件」連結。
2. 點連結 → 填條件 → 儲存 → 回試算表看 `subscriptions` 分頁有沒有新增一列。
3. GitHub **Actions → 「591 租屋通知（多人版）」→ Run workflow** → 看有沒有推到那個 LINE。

### G. 正式啟用
測試 OK 後：
1. 打開 `.github/workflows/notify-591-multi.yml` 裡被註解的 `schedule`。
2. 停用單人版 `notify-591.yml`（避免對你自己重複推播、也避免雙倍 Actions 額度）：
   在 GitHub Actions 頁面把該 workflow「Disable」，或把它的 `schedule` 註解掉。

## 資料格式
`subscriptions` 工作表每列一位使用者，欄位：
`userId, name, region, district, priceMin, priceMax, roomType, keyword, maxResults, balcony, elevator, pet, airConditioner, cooking, enabled, updatedAt`

GitHub Actions 透過 `SUBSCRIPTIONS_URL`（`?action=list&token=`）讀這份清單，
把相同搜尋條件的人歸成一組、同條件只抓一次，再依每人條件與各自的已推紀錄
（`notify-bot/state/subscribers-seen.json`）推播。
