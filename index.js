// Deploy as: Netlify Function (netlify/functions/zoho-stock.js)
// or Vercel Serverless Function (api/zoho-stock.js)
//
// PURPOSE: Fetches your Zoho Analytics public report and returns
// stock data as clean JSON — avoiding CORS issues from Shopify's frontend.
//
// ZOHO_REPORT_URL: Your public Zoho Analytics share URL
// e.g. https://analytics.zoho.com/open-view/1908942000009542263
//
// Add ?format=json to get raw JSON data from Zoho's embed API.
// Zoho also supports CSV export via ?exportType=csv&fileFormat=csv

const ZOHO_REPORT_URL = "https://analytics.zoho.com/open-view/1908942000009542263";

// ── Column names in your Zoho spreadsheet ──────────────────────────────────
// Change these to match your actual column headers exactly.
const COL_SKU        = "SKU";         // e.g. "TSHIRT-RED-M"
const COL_PRODUCT_ID = "Product ID";  // Shopify product/variant ID
const COL_STOCK      = "Stock";       // numeric stock count

// ── Cache: how long (seconds) to cache the Zoho response ──────────────────
const CACHE_TTL = 60; // 60 seconds — Zoho syncs from CSV/sheet periodically

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers — only allow requests from your Shopify store
  const ALLOWED_ORIGIN = process.env.SHOPIFY_STORE_DOMAIN
    ? `https://${process.env.SHOPIFY_STORE_DOMAIN}`
    : "*"; // fallback: allow all (restrict in production)

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", `s-maxage=${CACHE_TTL}, stale-while-revalidate`);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Optional: filter by a specific SKU or product ID passed as query param
  const { sku, product_id } = req.query || {};

  try {
    // Fetch Zoho report as JSON
    // Zoho's embed API accepts ?exportType=csv&fileFormat=json on public URLs
    const zohoUrl = `${ZOHO_REPORT_URL}?exportType=csv&fileFormat=json`;
    const response = await fetch(zohoUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ShopifyStockSync/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Zoho returned HTTP ${response.status}`);
    }

    const raw = await response.json();

    // Zoho JSON export structure:
    // { "data": [ { "SKU": "...", "Stock": 42, ... }, ... ] }
    // Adjust the path below if your export has a different wrapper key.
    const rows = raw?.data ?? raw?.rows ?? raw ?? [];

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected Zoho response format");
    }

    // Build a lookup map: { "SKU-or-ID": stockCount }
    const stockMap = {};
    for (const row of rows) {
      const key = sku
        ? row[COL_SKU]        // if filtering by SKU
        : row[COL_PRODUCT_ID] // default: keyed by Shopify product ID
          ?? row[COL_SKU];

      const qty = parseInt(row[COL_STOCK], 10);
      if (key) stockMap[String(key)] = isNaN(qty) ? 0 : qty;
    }

    // If a specific SKU/product_id was requested, return just that value
    if (sku) {
      const qty = stockMap[sku] ?? null;
      return res.status(200).json({ sku, stock: qty });
    }
    if (product_id) {
      const qty = stockMap[product_id] ?? null;
      return res.status(200).json({ product_id, stock: qty });
    }

    // Otherwise return the full map
    return res.status(200).json({ stock: stockMap, updated_at: new Date().toISOString() });

  } catch (err) {
    console.error("[zoho-stock-proxy]", err.message);
    return res.status(500).json({ error: "Failed to fetch stock data", detail: err.message });
  }
}

// ── Netlify alternative export ─────────────────────────────────────────────
// If deploying as a Netlify function, replace the export above with:
//
// exports.handler = async (event) => {
//   const req = { method: event.httpMethod, query: event.queryStringParameters };
//   const chunks = [];
//   const res = {
//     statusCode: 200, headers: {},
//     setHeader(k, v) { this.headers[k] = v; },
//     status(c) { this.statusCode = c; return this; },
//     json(body) { chunks.push(JSON.stringify(body)); return this; },
//     end() {},
//   };
//   await handler(req, res);
//   return { statusCode: res.statusCode, headers: res.headers, body: chunks.join("") };
// };
