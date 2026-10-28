/* RUN THIS — 4 lines
 * ---------------------------------------------------------------
 * Where: DevTools → Console on https://hive.carrybee.com/orders
 *        (reload the page first if a previous paste hung the tab)
 *
 * It downloads docs/hive-min.js from a pinned commit and runs it. There is
 * nothing to copy by hand, which is how the earlier broken snippet got pasted.
 *
 * Expected within a second:  "Businesses: 540"
 * Then progress every 25 merchants, and finally a HIVEPASTE1 … HIVEPASTE0 block.
 *
 * If it prints "Load failed": the page's CSP blocks github.com. Then open
 *   https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/27263f869bf20e1ff5090dda451edbb3fd053411/docs/hive-min.js
 * in a new tab, Ctrl+A, Ctrl+C, and paste it into the console instead.
 */
fetch("https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/27263f869bf20e1ff5090dda451edbb3fd053411/docs/hive-min.js")
  .then(r => r.ok ? r.text() : Promise.reject("HTTP " + r.status))
  .then(t => {
    // Exact version check, not a heuristic: only the fixed sweep contains this.
    if (!t.includes("hive-min-1")) throw new Error("downloaded the wrong file");
    (0, eval)(t);
  })
  .catch(e => console.error("Load failed:", e && e.message || e));
