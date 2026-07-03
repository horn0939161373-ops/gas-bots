# 591 爬蟲服務（Playwright + Cloud Run）

用 headless Chromium 開啟 591 租屋網的搜尋結果頁，等頁面 JS 完成渲染後直接從 DOM 擷取物件資料，回傳給 `rental-bot`（GAS 端）呼叫。

## 為什麼不直接在 GAS 裡用 UrlFetchApp 打 591 的 API？

591 目前的防護包含：

1. 搜尋 API 回應是 AES 加密過的，金鑰藏在會變動的前端 JS 裡
2. 會偵測瀏覽器指紋（例如 `navigator.webdriver`）

單純的 HTTP 請求（不管是 GAS 的 `UrlFetchApp` 還是 Node.js 的 `fetch`）已經無法穩定取得資料，必須真的用瀏覽器把頁面渲染出來。Google Apps Script 完全沒有能力做到這件事，所以拆成獨立的爬蟲服務，跑在能執行 headless browser 的 Cloud Run 上。

## API

所有端點都需要帶 header `x-scraper-secret: <SCRAPER_SECRET>`（`/health` 除外）。

- `GET /health` → `{ ok: true }`，Cloud Run 健康檢查用，不需要驗證。
- `POST /search`，body:
  ```json
  {
    "region": "1",
    "priceMin": 5000,
    "priceMax": 15000,
    "kind": "2",
    "keyword": "",
    "facilities": ["cold", "balcony_1"]
  }
  ```
  回傳：
  ```json
  { "ok": true, "url": "...", "count": 12, "items": [ { "id": "...", "title": "...", "price": 12000, "cover": "...", "url": "..." } ] }
  ```
- `GET /debug?region=1&kind=2&keyword=` → 回傳頁面標題與部分 HTML，方便對照實際頁面結構調整 `index.js` 的 `extractListings` 選取邏輯。

## 本地測試

```bash
cd scraper-service
npm install
SCRAPER_SECRET=test-secret node index.js
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -H "x-scraper-secret: test-secret" \
  -d '{"region":"1"}'
```

## 部署到 Cloud Run

### 手動部署（第一次）

```bash
gcloud run deploy rental-591-scraper \
  --source scraper-service \
  --region asia-east1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "SCRAPER_SECRET=<自訂一組隨機字串>"
```

部署完成後把印出的服務網址設定到 GAS 專案的 Script Properties `SCRAPER_SERVICE_URL`，`SCRAPER_SECRET` 設定到 `SCRAPER_SERVICE_SECRET`。

### 用 GitHub Actions 自動部署

`.github/workflows/deploy-scraper.yml` 會在 `scraper-service/**` 有變更並推到 `main` 時自動部署，需要先在 repo 設定以下 Secrets：

- `GCP_SA_KEY`：有 Cloud Run 部署權限的服務帳號金鑰（JSON）
- `GCP_PROJECT_ID`：GCP 專案 ID
- `SCRAPER_SECRET`：跟 GAS 端 `SCRAPER_SERVICE_SECRET` 一致的隨機字串

## 費用注意事項

- `--min-instances 0` 代表沒有請求時不收費，但冷啟動（要重新啟動瀏覽器）會比較慢，第一次呼叫可能要等幾秒。
- Chromium 需要較多記憶體，這裡設定 2Gi／2 CPU；免費額度有限，實際費用視呼叫頻率而定，建議先以較低的 `triggerRentalCheck` 觸發頻率（例如每 30 分鐘）觀察費用再調整。

## 已知限制 / 待你部署後校準

`extractListings`（`index.js`）是依 591 目前頁面結構的最佳猜測（用「連到物件詳情頁的連結」當錨點），不是逐一驗證過的精確選取器。第一次部署後，如果 `/search` 回傳 `count: 0` 或資料明顯不對，請：

1. 呼叫 `GET /debug?region=1` 看實際回傳的 HTML 片段
2. 對照 `bodyHtmlSnippet` 調整 `index.js` 裡 `extractListings` 的選取邏輯（例如物件容器的標籤、price 的文字格式）
