/* PASTE-ONLY LOADER — 6 lines, nothing else
 * ----------------------------------------------------------------
 * Where: DevTools → Console on  https://hive.carrybee.com/orders
 *        (while logged in, on the Orders page)
 *
 * It downloads the real script from the public GitHub repo and runs it,
 * so you don't have to copy 37 KB by hand. Nothing is sent anywhere;
 * the only network call is to raw.githubusercontent.com.
 *
 * After pasting you should see:
 *        Script loaded. Now run:  await hiveOrders.run()
 *
 * If you see "Load failed": the page's Content-Security-Policy probably
 * blocks github.com. In that case open the raw URL in a new tab, Ctrl+A,
 * Ctrl+C, and paste the whole file into the console instead.
 */
fetch("https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/39f7eb881f5db570e00e79061a077efb278d07c9/docs/hive-orders-pull.js")
  .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
  .then(function (t) {
    if (t.indexOf("BUSINESSES") === -1) throw new Error("downloaded the wrong file");
    (0, eval)(t);
    console.log("%cScript loaded. Now run:  await hiveOrders.run()", "color:#0E9F6E;font-weight:bold");
  })
  .catch(function (e) {
    console.error("Load failed →", e.message);
    console.log("Fallback: open this URL in a new tab, Ctrl+A, Ctrl+C, paste it into the console:\n" +
      "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/39f7eb881f5db570e00e79061a077efb278d07c9/docs/hive-orders-pull.js");
  });
