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
建議直接從**試算表 擴充功能 → Apps Script**（綁定式，最省事，免設 `SPREADSHEET_ID`）：
1. 在 A 的試算表點 **擴充功能 → Apps Script**。
2. 把 `gas/Code.gs` 內容貼進預設的「程式碼.gs」。
3. 左側 **+ → HTML**，命名 **`Index`**，貼入 `gas/Index.html`；再建 **`Manage`** 貼入 `gas/Manage.html`。
4. 齒輪 **專案設定 → 指令碼屬性**，新增兩個：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 你的 LINE OA channel access token
   - `API_TOKEN` = 自訂一串亂數（GitHub secret 要用同一串）
   - （綁定式免設 `SPREADSHEET_ID`；獨立式指令碼才要加它 = A 的試算表 ID）

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

## 自動部署（repo 改動自動寫入 GAS，免手動貼程式）

設定好之後，`gas/` 底下的檔案只要合併進 `main`，GitHub Actions（`.github/workflows/deploy-gas.yml`）
就會自動用 [clasp](https://github.com/google/clasp) 推上你的 Apps Script 專案並更新 Web App 部署，
**exec 網址不變**、LINE webhook 不用重設。

一次性設定（綁你的 Google 帳號，只能本人操作；需要一台電腦，或用免安裝的
[Google Cloud Shell](https://shell.cloud.google.com)）：

1. 到 <https://script.google.com/home/usersettings> 開啟 **Google Apps Script API**。
2. 在電腦或 Cloud Shell 執行：
   ```
   npm install -g @google/clasp
   clasp login
   ```
   跑完後把 `~/.clasprc.json` 的**完整內容**複製起來（Cloud Shell 用 `cat ~/.clasprc.json`）。
3. 取得兩個 ID：
   - **指令碼 ID**：GAS 編輯器 → 齒輪「專案設定」→「指令碼 ID」
   - **部署 ID**：GAS 編輯器 → 部署 → **管理部署作業** → 現用 Web App 部署的 ID（`AKfycb` 開頭）
4. 到 repo **Settings → Secrets and variables → Actions** 新增三個 secret：

   | Secret 名稱 | 值 |
   |---|---|
   | `CLASPRC_JSON` | 步驟 2 複製的 `~/.clasprc.json` 完整內容 |
   | `GAS_SCRIPT_ID` | 指令碼 ID |
   | `GAS_DEPLOYMENT_ID` | 部署 ID（不填就只更新程式碼、不換版本，exec 會繼續跑舊版） |

⚠️ 啟用後 **repo 是唯一的真相來源**：要改 GAS 程式一律改 repo 裡的 `gas/*`，
不要直接在 GAS 編輯器改，不然下次自動部署會把線上改動蓋掉。

## 功能
- **一人多組**：同一個人可存多組不同條件（每列一組，`subId` 唯一）。
- **縣市→行政區勾選**：選縣市後自動帶出行政區 checkbox。六都（台北/新北/桃園/
  台中/台南/高雄）行政區已全部內建（代碼直接從 591 網站傾印，見下方維護工具）；
  清單沒列到的區可用表單的「其他行政區（手動輸入代碼）」欄補上；其他縣市則整欄
  手動輸入。要補齊/新增縣市：到 Actions 手動跑「傾印 591 行政區代碼表」workflow
  （可指定 region 代碼），把 log 裡的結果加進 `Code.gs` 的 `DISTRICTS_BY_REGION`。
- **管理頁**：`?action=manage&uid=` 可查看/編輯/暫停/刪除自己的訂閱；加好友時
  bot 會同時回「新增」與「管理」兩個連結。

## 資料格式
`subscriptions` 工作表每列一組訂閱，欄位：
`subId, userId, name, region, district, priceMin, priceMax, roomType, keyword, maxResults, balcony, elevator, pet, airConditioner, cooking, enabled, updatedAt`

GitHub Actions 透過 `SUBSCRIPTIONS_URL`（`?action=list&token=`）讀這份清單，
把相同搜尋條件的訂閱歸成一組、同條件只抓一次，再依每組條件與各自的已推紀錄
（`notify-bot/state/subscribers-seen.json`，用 `subId` 當 key）推播。
