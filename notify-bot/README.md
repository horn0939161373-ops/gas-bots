# 591 租屋通知 Bot（GitHub Actions 版）

定時用 Playwright 開真實瀏覽器抓 591 租屋網的搜尋結果，跟上次推播過的紀錄比對，有新物件就用 LINE 推播通知。全部跑在 GitHub Actions 上，**不需要 GCP、不需要 Docker、不需要任何雲端主控台**。

## 為什麼要用真的瀏覽器，不能單純發 HTTP 請求？

591 目前的防護包含：搜尋 API 回應是 AES 加密過的（金鑰藏在會變動的前端 JS 裡），而且會偵測瀏覽器指紋。單純的 HTTP 請求已經無法穩定取得資料，所以改成用 headless Chromium 把頁面真的渲染出來，直接讀取渲染完成的 DOM。

## 架構

```
GitHub Actions（排程，預設每 30 分鐘）
  → 開 headless Chromium 到 591 搜尋頁
  → 從渲染完的 DOM 擷取物件資料
  → 跟 state/seen-listings.json 比對，找出新物件
  → 用 LINE Messaging API 推播
  → 把新增的物件 id 寫回 state/seen-listings.json 並 commit
```

沒有資料庫、沒有伺服器——已推播紀錄直接存成 repo 裡的 JSON 檔，每次執行完自動 commit。

## 你需要做的事（僅這兩步，跟身份綁定、無法代勞）

### 1. 建立 LINE Messaging API channel、取得 Token 與推播對象 ID

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立一個 Provider，再建立一個 **Messaging API channel**
2. 在該 channel 的「Messaging API」頁籤，簽發一組 **Channel access token（long-lived）**
3. 取得推播對象的 ID：
   - **推給自己**：在該 channel 的「Basic settings」頁籤能看到你自己的 **User ID**（`U` 開頭）
   - **推到群組**：把這個官方帳號加進 LINE 群組，開啟 webhook 後傳一則訊息，從 webhook log 裡的 `source.groupId` 取得（`C` 開頭）——這步如果不需要群組通知可以跳過，直接用個人 User ID 即可

### 2. 把兩個值設定成這個 repo 的 GitHub Secrets

到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，新增：

| Secret 名稱 | 值 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 上一步簽發的 Channel access token |
| `LINE_TARGET_ID` | 你自己的 User ID 或群組 ID |

## 設定篩選條件（你可以隨時自己改，不需要懂程式）

到 repo 網頁上打開 `notify-bot/config.json`，點右上角鉛筆圖示編輯，改完直接在網頁上 commit 即可（手機瀏覽器也能做）。下次排程執行就會套用新條件，完全不需要碰程式碼。

```json
{
  "region": "台北市",
  "district": "",
  "priceMin": 0,
  "priceMax": 0,
  "roomType": "不限",
  "keyword": "",
  "balcony": false,
  "elevator": false,
  "pet": false,
  "airConditioner": false,
  "cooking": false
}
```

| 欄位 | 說明 |
|---|---|
| `region` | 縣市名稱（例如 `"台北市"`），見下表；打錯字或查無此縣市會在 Actions log 印警告、視為不限 |
| `district` | 縣市內的行政區（例如 `"鼓山區"`），見下方行政區代碼表；留空 `""` 代表整個縣市都搜尋。目前只建了高雄市的行政區代碼，其他縣市填了會在 log 印警告並自動退回只用縣市層級搜尋 |
| `priceMin` / `priceMax` | 租金區間，都填 `0` 代表不限 |
| `roomType` | 房型：`"不限"`、`"整層住家"`、`"獨立套房"`、`"分租套房"`、`"雅房"`、`"別墅"` |
| `keyword` | 關鍵字（例如 `"近捷運"`），不需要留空字串 `""` |
| `balcony` | 是否要有陽台，`true`/`false` |
| `elevator` | 是否要有電梯，`true`/`false` |
| `pet` | 是否可養寵物，`true`/`false` |
| `airConditioner` | 是否要有冷氣，`true`/`false` |
| `cooking` | 是否可開伙，`true`/`false` |

縣市名稱對照（已用實際 591 網址逐一核對過；也可以直接填數字代碼）：

| 縣市 | 代碼 | 縣市 | 代碼 |
|---|---|---|---|
| 台北市 | 1 | 彰化縣 | 10 |
| 基隆市 | 2 | 南投縣 | 11 |
| 新北市 | 3 | 嘉義市 | 12 |
| 新竹市 | 4 | 嘉義縣 | 13 |
| 新竹縣 | 5 | 雲林縣 | 14 |
| 桃園市 | 6 | 台南市 | 15 |
| 苗栗縣 | 7 | 高雄市 | 17 |
| 台中市 | 8 | 屏東縣 | 19 |
|  |  | 宜蘭縣 | 21 |
|  |  | 台東縣 | 22 |
|  |  | 花蓮縣 | 23 |
|  |  | 澎湖縣 | 24 |
|  |  | 金門縣 | 25 |

高雄市行政區代碼（目前唯一建好的行政區對照表；已用實際 591 網址逐一核對過）：

| 行政區 | 代碼 | 行政區 | 代碼 |
|---|---|---|---|
| 新興區 | 243 | 三民區 | 250 |
| 苓雅區 | 245 | 楠梓區 | 251 |
| 鼓山區 | 247 | 左營區 | 253 |
| 前鎮區 | 249 | 鳳山區 | 268 |

其他縣市的行政區代碼需要時可以自己查：到 591 網站選好縣市與行政區，從網址列的 `section=` 參數取得代碼，直接填數字代碼到 `district` 欄位也可以用（不一定要中文名稱），或是把新查到的代碼加進 `src/config.js` 的 `SECTION_MAP`。

## 執行排程

`.github/workflows/notify-591.yml` 預設每 30 分鐘跑一次（`cron: '*/30 * * * *'`）。

⚠️ **GitHub 的排程觸發只會在預設分支（`main`）上生效**，這個 workflow 合併到 `main` 之前不會自動排程執行；也可以在 GitHub 網頁的 Actions 頁籤手動點 "Run workflow"（`workflow_dispatch`）立即測試一次。

## 穩定性：591 偶爾會擋，怎麼處理的？

實測發現 591 的防護會不定期把「某些」GitHub Actions 出口 IP 列入黑名單——同一支 workflow，不同次執行拿到不同 IP 時，會在「完全被擋」跟「完全正常」之間切換，不是永久封鎖整個 GitHub Actions。因應方式：

1. **單次執行內重試**：`src/scrape.js` 偵測到疑似被擋（HTTP 4xx）會自動重試一次
2. **排程本身就是最大的保險**：就算某一輪剛好抽到被封鎖的 IP，程式會安靜跳過（不會誤報、不會中斷），下一輪（30 分鐘後）換一台全新的 runner／IP，很有機會就正常了
3. 如果連續好幾輪都抓不到資料，才需要懷疑是選取器或帳密設定的問題（見下方「除錯」）

## 費用 / Actions 分鐘數注意事項

- Private repo 的 GitHub Actions 有每月分鐘數額度（Free 方案約 2000 分鐘/月）。每 30 分鐘跑一次、每次約 1-2 分鐘（含安裝 Chromium），粗估一個月會用掉 1500-3000 分鐘，可能接近或超過免費額度。如果額度吃緊，把 cron 間隔拉長（例如改成每小時 `0 * * * *`）即可大幅降低用量。

## 除錯

第一次跑完如果 log 顯示「抓到 0 筆物件」，代表 `src/scrape.js` 裡 `extractListings` 的 DOM 選取邏輯跟目前 591 頁面結構對不上（591 頁面結構若改版本來就可能需要調整）。可以在 Actions 的執行紀錄裡看實際console輸出，或本機安裝 Playwright 後直接跑 `node -e "require('./src/scrape').scrapeListings({region:'1'}).then(r=>console.log(r))"` 除錯調整選取器。
