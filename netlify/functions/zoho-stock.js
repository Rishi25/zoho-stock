// netlify/functions/zoho-stock.js
//
// Fetches stock data from a Zoho Analytics PUBLIC report URL.
// No OAuth, no org ID — just the public share link.
//
// Zoho public report CSV export URL format:
//   https://analytics.zoho.com/open-view/{VIEW_ID}/csv
//
// ENV vars needed (set in Netlify → Site → Environment variables):
//   ZOHO_VIEW_ID   — the number from your share URL (e.g. 1908942000009542263)
//                    OR leave blank to use DEFAULT_VIEW_ID below

const COL_SKU  = "SKU";
const CITIES   = ["Ahmedabad", "Chandigarh"];
const DEFAULT_VIEW_ID = "1908942000009542263";

// ── Fetch CSV from Zoho public report ────────────────────────────────────────
async function fetchZohoCsv() {
  const viewId = process.env.ZOHO_VIEW_ID || DEFAULT_VIEW_ID;

  // Zoho public report CSV export endpoint
  // Adding /csv to the open-view URL triggers a direct CSV download
  const url = `https://analytics.zoho.com/open-view/1908942000009542263?exportType=csv&fileFormat=csv&isAggr=true`;

  const response = await fetch(url, {
    headers: {
      // Mimic a browser request — Zoho occasionally blocks non-browser agents
      "User-Agent": "Mozilla/5.0 (compatible; StockSync/1.0)",
      "Accept": "text/csv, text/plain, */*",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Zoho public report error (${response.status}): ${text.slice(0, 200)}`);
  }
  if (text.toLowerCase().includes("<html")) {
    throw new Error(
      "Zoho returned an HTML page instead of CSV. " +
      "Check that the report is publicly shared: " +
      "Zoho Analytics → Share → Publish → Enable public access."
    );
  }

  return text;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields, BOM, CRLF
function parseCsv(csvText) {
  return csvText
    .replace(/^\uFEFF/, "")   // strip BOM
    .trim()
    .split(/\r?\n/)
    .map((row) =>
      row.split(",").map((cell) =>
        cell.replace(/^"|"$/g, "").trim()
      )
    );
}

// ── Netlify handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const sku = String(event.queryStringParameters?.sku || "").trim().toUpperCase();

  const headers = {
    "Access-Control-Allow-Origin": "https://mortantra.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "s-maxage=60, stale-while-revalidate",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (!sku) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing required query parameter: sku" }),
    };
  }

  try {
    const rows = parseCsv(await fetchZohoCsv());
    const csvHeaders = rows[0];

    const skuIndex = csvHeaders.indexOf(COL_SKU);
    if (skuIndex === -1) {
      throw new Error(
        `CSV missing column "${COL_SKU}". ` +
        `Found columns: ${csvHeaders.join(", ")}`
      );
    }

    // Find all rows matching this SKU
    const matchingRows = rows.filter(
      (row, i) =>
        i > 0 &&
        String(row[skuIndex] || "").trim().toUpperCase() === sku
    );

    // Build per-city availability
    const cities = {};
    CITIES.forEach((city) => {
      const cityIndex = csvHeaders.indexOf(city);
      cities[city] =
        cityIndex !== -1 &&
        matchingRows.some(
          (row) =>
            String(row[cityIndex] || "").trim().toLowerCase() === "available"
        );
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sku, cities }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch stock",
        detail: error.message,
      }),
    };
  }
};
