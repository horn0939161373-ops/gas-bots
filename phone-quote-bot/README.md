# 米可手機報價通知 Bot（GitHub Actions 版）

定時用 Playwright 開真實瀏覽器抓[米可手機館](https://www.miko3c.com/price/phone/)的空機報價，跟你在網頁上勾選的關注清單比對，有新上架或降價就用 LINE 推播通知。可以用一個小網頁（GitHub Pages）搜尋、勾選想追蹤的機型，不用自己手動打字。全部跑在 GitHub Actions 上，**不需要 GCP、不需要 Docker、不需要任何雲端主控台**。

## 架構

```
GitHub Actions（排程，預設每小時一次）
  → 開 headless Chromium 抓米可手機館的報價頁
  → 把完整報價清單寫進 docs/phones.json（給選手機網頁用）
  → 跟 watchlist.json（你勾選的關注清單）比對
  → 跟 state/last-prices.json 比對，找出「新上榜」或「價格有變動」的機型
  → 用 LINE Messaging API 推播
  → 把最新報價寫回 state/last-prices.json 並 commit

GitHub Pages（docs/ 資料夾）
  → docs/index.html：搜尋、勾選手機的小網頁
  → docs/phones.json：上面那支排程抓到的最新報價（網頁直接讀取）
```

沒有資料庫、沒有伺服器——報價資料、關注清單、推播紀錄都直接存成 repo 裡的 JSON 檔。

## 你需要做的事

### 1. LINE Messaging API 設定

跟 [`notify-bot`](../notify-bot) 共用同一組 LINE channel 跟 GitHub Secrets（`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_TARGET_ID`）。如果你已經設定過 591 通知 bot，這裡不用再設一次；如果還沒設定過，請照 [`notify-bot/README.md`](../notify-bot/README.md) 的「1. 建立 LINE Messaging API channel」跟「2. 把兩個值設定成這個 repo 的 GitHub Secrets」兩步做。

如果想讓手機報價推播到跟房租通知不同的 LINE 對象，把 `.github/workflows/phone-quote.yml` 裡的 `LINE_TARGET_ID` 改指到另一個新的 Secret（例如 `PHONE_LINE_TARGET_ID`）即可，channel token 仍可共用。

### 2. 開啟 GitHub Pages（讓選手機的小網頁能被打開）

1. 到 repo 的 **Settings → Pages**
2. **Source** 選 **Deploy from a branch**
3. **Branch** 選 `main`，資料夾選 `/docs`，按 **Save**
4. 幾分鐘後，網頁網址會顯示在同一頁（通常長得像 `https://<你的帳號>.github.io/gas-bots/`）

⚠️ GitHub Pages 只會 build **預設分支**（`main`）上的內容，這個功能合併到 `main` 之前網頁不會生效。

## 怎麼選要追蹤的手機

1. 打開上面設定好的 GitHub Pages 網頁
2. 搜尋、勾選想追蹤報價的機型（可複選）
3. 按「複製設定內容」
4. 按「在 GitHub 上開啟 watchlist.json」，把檔案內容整個換成剛複製的內容，在網頁上按 **Commit changes**
5. 等下一次排程執行（或到 Actions 頁籤手動 `Run workflow`），有新報價或降價就會推播到 LINE

網頁第一次打開時 `docs/phones.json` 會是空的（`[]`），要等排程第一次成功執行完才會有資料。

## `watchlist.json` 格式

一個字串陣列，每個字串是關鍵字，只要跟抓到的手機標題「部分相符」（不分大小寫）就算命中：

```json
[
  "iPhone 17 Pro 256G",
  "Galaxy S26 Ultra"
]
```

- 用選手機網頁產生的內容，會是完整、精準的標題文字，保證命中
- 也可以自己手動編輯，填比較短的關鍵字（例如只填 `"iPhone 17 Pro"` 不含容量），這樣所有容量版本都會命中
- 留空陣列 `[]` 代表沒有要追蹤的機型，排程只會更新 `docs/phones.json`（給網頁用），不會推播

## 什麼時候會推播？

同一支手機（用商品網址判斷是否同一支）：

- **第一次**在關注清單裡被抓到報價 → 推播（標示「目前報價」）
- 之後**報價有變動**（不管漲價或降價）→ 推播，並顯示前次報價與漲跌方向
- 報價沒變 → 不會重複推播，避免洗版

## 執行排程

`.github/workflows/phone-quote.yml` 預設每小時跑一次（`cron: '0 * * * *'`）。也可以在 GitHub 網頁的 Actions 頁籤手動點 "Run workflow"（`workflow_dispatch`）立即測試一次。

⚠️ **GitHub 的排程觸發只會在預設分支（`main`）上生效**，這個 workflow 合併到 `main` 之前不會自動排程執行。

## 除錯

`https://www.miko3c.com/price/phone/` 實際上是一個「價格總覽」表格（型號｜原廠建議售價｜米可破盤價｜優惠活動），每一列**沒有連到商品詳情頁的連結**。`src/scrape.js` 的 `parsePhonesFromText()` 是直接解析渲染完成頁面的 `innerText`，找「標題行 → 原價數字 → 米可破盤價數字」這個固定樣式，不依賴任何 CSS class（已用 Actions log 的實際輸出核對過解析邏輯）。

如果米可改版導致 log 顯示「抓到 0 支手機」：

1. 到 Actions 的執行紀錄裡看 log 印出的除錯資訊（頁面標題、`<a>` 標籤總數、頁面文字前 2000 字），通常可以直接看出格式哪裡變了
2. 或本機安裝 Playwright 後直接跑 `node -e "require('./src/scrape').scrapePhones().then(r=>console.log(JSON.stringify(r.slice(0,5),null,2)))"`，打開瀏覽器開發者工具核對 `https://www.miko3c.com/price/phone/` 目前的文字排列方式，調整 `parsePhonesFromText()` 裡的規則

`parsePhonesFromText()` 本身也可以直接單元測試，不需要真的連網：`require('./src/scrape').parsePhonesFromText(某段文字)`。

## 費用 / Actions 分鐘數注意事項

- Private repo 的 GitHub Actions 有每月分鐘數額度（Free 方案約 2000 分鐘/月）。每小時跑一次、每次約 1-2 分鐘（含安裝 Chromium），一個月約用掉 700-1500 分鐘。如果額度吃緊（跟 591 bot 共用額度），把 cron 間隔拉長（例如改成每 2 小時 `0 */2 * * *`）即可降低用量。
