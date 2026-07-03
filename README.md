# gas-bots
LINE Bot GAS 專案

591 租屋新物件通知 Bot，分兩部分部署：

- [`rental-bot`](./rental-bot)：Google Apps Script，處理 LINE 對話、篩選條件設定、定時推播
- [`scraper-service`](./scraper-service)：Node.js + Playwright，跑在 Cloud Run，負責用真實瀏覽器抓 591 資料（591 有加密/瀏覽器指紋防護，純 HTTP 請求已無法穩定取得資料，詳見該資料夾 README）

部署順序：先部署 `scraper-service` 取得服務網址，再部署 `rental-bot` 並在 Script Properties 設定該網址。
