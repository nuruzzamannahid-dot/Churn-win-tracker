/* RUN THIS — order-date backfill, 4 lines
 * ---------------------------------------------------------------
 * Where: DevTools → Console on https://hive.carrybee.com/orders
 *        (logged in; the tab must be on the orders page)
 *
 * It downloads docs/hive-dates.js from a pinned commit and runs it, so there is
 * nothing to copy by hand and no chance of picking up an old version.
 *
 * Expected within a second:  "Targets: 191"
 * Then progress every 20 merchants, finishing with
 *   HIVEDATES1
 *   <id>|<orders>|<days>|<first>|<last>;…
 *   HIVEDATES0
 *
 * Copy the block and send it back. Do not paste a single line out of the file —
 * statements like `out.push(...)` only mean anything inside the sweep.
 *
 * If it prints "Load failed": the page's CSP blocks github.com. Then open
 *   https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/6c0dcbc377920f7ae787c0b94a5bd04f4f9ce5ce/docs/hive-dates.js
 * in a new tab, Ctrl+A, Ctrl+C, and paste that into the console instead.
 */
fetch("https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/6c0dcbc377920f7ae787c0b94a5bd04f4f9ce5ce/docs/hive-dates.js")
  .then(r => r.ok ? r.text() : Promise.reject("HTTP " + r.status))
  .then(t => {
    // Exact version check, not a heuristic: only the dates sweep has this.
    if (!t.includes("hive-dates-1")) throw new Error("downloaded the wrong file");
    (0, eval)(t);
  })
  .catch(e => console.error("Load failed:", e && e.message || e));
