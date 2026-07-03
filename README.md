# gas-bots

591 租屋新物件通知 Bot，全部跑在 GitHub Actions 上（不需要 GCP、不需要 Google Apps Script、不需要任何額外雲端帳號）。

- [`notify-bot`](./notify-bot)：Node.js + Playwright，用真實瀏覽器定時抓 591 租屋網搜尋結果，跟已推播紀錄比對後用 LINE 推播新物件。設定方式與必要的 GitHub Secrets 見該資料夾 README。
- [`phone-quote-bot`](./phone-quote-bot)：Node.js + Playwright，定時抓米可手機館（miko3c.com）空機報價，用一個 GitHub Pages 小網頁（[`docs/`](./docs)）搜尋、勾選想追蹤的機型，有新報價或降價就用 LINE 推播。設定方式見該資料夾 README。
