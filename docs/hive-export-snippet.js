/* Hive → Churn Win Tracker data grabber
 * -------------------------------------
 * Use when Hive has no "Export CSV" button on
 *   https://hive.carrybee.com/businesses?isActive=true
 *
 * 1. Open that page while logged in.
 * 2. Set rows-per-page to the largest value (100 / 500) if the table offers it.
 * 3. Open DevTools → Console, paste this whole file, press Enter.
 * 4. It prints what it found and copies CSV to your clipboard.
 *    Paste it into a file `hive_export.csv` and hand it over.
 *
 * It tries, in order:
 *   A. `window.__NEXT_DATA__` / React props already on the page (best — full result set)
 *   B. React state on the root node (second best)
 *   C. The rendered <table> (last resort — only the rows on screen)
 */
(async function hiveGrab() {
  const WANT = {
    id: /^(id|business(id)?|shop(id)?|storeId|merchantId)$/i,
    name: /^(name|businessName|shopName|storeName)$/i,
    phone: /^(phone|phoneNumber|mobile|mobileNumber|contact|contactNumber)$/i,
    orders: /^(lifetimeOrders?|totalOrders?|orders?|orderCount|totalOrderCount|deliveredOrders?)$/i,
    days: /^(activeDays?|daysActive|lifetimeActiveDays|activeDayCount)$/i
  };

  const flat = [];
  const seen = new WeakSet();

  function looksLikeRow(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    const keys = Object.keys(o);
    const hasMetric = keys.some(k => /order|active/i.test(k));
    const hasWho = keys.some(k => /business|shop|store|merchant|phone|mobile/i.test(k));
    return hasMetric && hasWho;
  }

  function walk(node, depth) {
    if (!node || depth > 8 || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return; }
    if (looksLikeRow(node)) flat.push(node);
    for (const k of Object.keys(node)) walk(node[k], depth + 1);
  }

  // A + B: page data and React props
  walk(window.__NEXT_DATA__, 0);
  const root = document.getElementById("__next") || document.body.firstElementChild;
  if (root) {
    const propsKey = Object.keys(root).find(k => k.startsWith("__reactProps") || k.startsWith("__reactContainer") || k.startsWith("__reactFiber"));
    if (propsKey) walk({ stateNode: root[propsKey] }, 0);
  }

  let rows = flat;
  let source = "__NEXT_DATA__ / React props";

  // C: rendered table
  if (!rows.length) {
    const table = document.querySelector("table");
    if (table) {
      const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
      rows = [...table.querySelectorAll("tbody tr")].map(tr => {
        const cells = [...tr.querySelectorAll("td")].map(td => td.textContent.trim());
        const o = {};
        heads.forEach((h, i) => { if (h) o[h] = cells[i]; });
        return o;
      });
      source = "rendered <table>";
    }
  }

  if (!rows.length) {
    console.warn("Nothing found. Try setting rows-per-page to max, or check the Network tab for a /businesses JSON response and copy it.");
    return;
  }

  // Map detected keys onto our five columns.
  const keys = Object.keys(rows[0]);
  const pick = re => keys.find(k => re.test(k));
  const cols = { id: pick(WANT.id), name: pick(WANT.name), phone: pick(WANT.phone), orders: pick(WANT.orders), days: pick(WANT.days) };

  const get = (o, k) => (k && (o[k] ?? (o[k.toLowerCase()] ?? ""))) ?? "";
  const missing = ["id", "orders", "days"].filter(k => !cols[k]);
  if (missing.length) {
    console.warn("Could not auto-detect these columns:", missing.join(", "));
    console.log("Example row — tell me which fields to use:", rows[0]);
    return;
  }

  const esc = v => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  const header = ["Business ID", "Business Name", "Phone", "Lifetime Orders", "Active Days"];
  const csv = [header.join(",")].concat(
    rows.map(r => [get(r, cols.id), get(r, cols.name), get(r, cols.phone), get(r, cols.orders), get(r, cols.days)].map(esc).join(","))
  ).join("\r\n");

  console.log(`Source: ${source} — ${rows.length} rows`);
  console.log(csv.slice(0, 400) + "\n…");
  try {
    await navigator.clipboard.writeText(csv);
    console.log("%cCSV copied to clipboard.", "color:#0E9F6E;font-weight:bold");
  } catch {
    console.log("Clipboard blocked — run copy(csv) below or save the console output.");
    window.csv = csv;
  }
})();
