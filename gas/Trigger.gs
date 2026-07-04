/**
 * 591 bot ─ GAS 定時器（解決 GitHub 內建排程不穩的問題）
 * ------------------------------------------------------------
 * GitHub 自己的 cron 很常漏跑；改由 GAS 的時間驅動觸發器每 30 分鐘用 API
 * 觸發 GitHub Actions 的 notify-591.yml，穩定又免費。
 *
 * 設定：
 *   1. 專案設定 → 指令碼屬性，新增 GITHUB_PAT = 你的 GitHub Fine-grained
 *      PAT（權限：對 gas-bots 的 Actions = Read and write）。
 *   2. 先手動執行一次 trigger591 授權連外，執行紀錄看到 204 即成功。
 *   3. 左側鬧鐘圖示 → 新增觸發條件：函式 trigger591、時間驅動、分鐘計時器、
 *      每 30 分鐘。
 *
 * 註：這支只負責「按時間戳一下 GitHub」，抓取 591 仍在 GitHub Actions 上跑。
 */
function trigger591() {
  var pat = PropertiesService.getScriptProperties().getProperty('GITHUB_PAT');
  var url = 'https://api.github.com/repos/horn0939161373-ops/gas-bots/actions/workflows/notify-591.yml/dispatches';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + pat,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  console.log(res.getResponseCode(), res.getContentText()); // 成功會是 204
}
