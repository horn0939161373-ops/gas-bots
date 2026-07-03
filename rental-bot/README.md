# 591 租屋通知 Bot

LINE Bot，讓使用者用聊天設定地區、租金區間、房型、關鍵字與設備條件，系統會定時到 [591 租屋網](https://rent.591.com.tw) 搜尋，發現符合條件的新物件時透過 LINE 推播通知。

## 檔案結構

| 檔案 | 說明 |
|---|---|
| `1_Config.gs` | LINE API 工具、Sheet 存取共用函式 |
| `2_Main.gs` | LINE Webhook 入口（`doPost`），文字/postback 訊息分派 |
| `3_Scraper591.gs` | 591 搜尋 API 呼叫（含 CSRF token/cookie 處理）與資料整理 |
| `4_FlexMessage.gs` | 所有 LINE Flex 卡片組裝 |
| `5_NotifyService.gs` | 定時查詢並推播新物件、清理過期紀錄 |
| `6_UserConfig.gs` | 使用者篩選條件 CRUD、設定精靈（Session）狀態機 |

## 部署設定

1. **Script Properties**：在 Apps Script 專案的「專案設定 → Script Properties」新增 `LINE_TOKEN`，值為 LINE Channel Access Token。程式碼不含任何硬編碼金鑰。
2. **Webhook URL**：部署為 Web App 後，將產生的網址設定到 LINE Developers Console 的 Webhook URL。
3. **時間觸發器**（在 Apps Script 編輯器「觸發條件」手動新增）：
   - `triggerRentalCheck`：建議每 15～30 分鐘執行一次，查詢所有已開啟通知的使用者並推播新物件。
   - `cleanupOldSeenListings`：建議每日執行一次，清理超過 14 天的已推播紀錄，避免 `SeenListings` 分頁無限增長。

## Google Sheet 分頁

執行時會自動建立以下分頁（首次執行前不需手動建立）：

- `UserFilterConfig`：使用者篩選條件（地區、價格、房型、關鍵字、設備、是否開啟通知）
- `SeenListings`：已推播過的物件 id，用來避免重複通知

## 使用方式（LINE 聊天指令）

- `選單`：開啟主選單
- `我的條件`：查看目前篩選設定
- `立即查詢`：用目前條件手動查一次
- 主選單按鈕：設定篩選條件（地區 → 價格 → 房型 → 關鍵字 → 設備）、開啟/關閉定時通知

## 已知限制

- 591 的搜尋 API 為非公開介面，欄位與防爬蟲驗證方式可能隨時調整；若查詢開始失敗，請優先檢查 `3_Scraper591.gs` 的 `fetch591Session` 與 API 參數是否仍符合 591 目前的行為。
- `REGION_MAP` 為公開資料整理的縣市代碼對照表，若設定的地區查不到預期結果，可到 591 網站手動搜尋該縣市，從網址列 `region=` 參數取得正確代碼後直接輸入數字。
- 請僅供個人查詢/研究使用，避免高頻率查詢對 591 伺服器造成負擔。
