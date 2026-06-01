// netlify/functions/zoho-stock.js
//
// Fetches CSV from a Zoho Analytics PUBLIC report using the correct export URL.
// No OAuth needed — report must have public access enabled in Zoho.

const COL_SKU         = "SKU";
const CITIES          = ["Ahmedabad", "Chandigarh"];
const DEFAULT_VIEW_ID = "1908942000009542263";

// ── Fetch CSV from Zoho public report ────────────────────────────────────────
async function fetchZohoCsv() {
  const viewId = process.env.ZOHO_VIEW_ID || DEFAULT_VIEW_ID;

  // Zoho Analytics correct CSV export URL for public reports:
  // The open-view URL with exportType + fileFormat params triggers raw CSV.
  // Do NOT append /csv — that returns the HTML viewer page.
  const url =
    `https://analytics.zoho.com/open-view/${viewId}` +
    `?exportType=csv&fileFormat=csv&isAggr=true`;

  console.log("[zoho-stock] Fetching:", url);

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/csv, text/plain, */*",
      "Referer": `https://analytics.zoho.com/open-view/${viewId}`,
    },
  });

  const text = await response.text();
  console.log("[zoho-stock] Status:", response.status);
  console.log("[zoho-stock] First 300 chars:", text.slice(0, 300));

  if (!response.ok) {
    throw new Error(`Zoho returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  // Zoho sometimes returns a JSON error wrapper even on 200
  if (text.trimStart().startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) {}
    if (parsed?.status === "error" || parsed?.errorCode) {
      throw new Error(`Zoho API error: ${parsed.errorMessage || text.slice(0, 200)}`);
    }
  }

  if (text.toLowerCase().includes("<html")) {
    // Log the page title to understand what Zoho is returning
    const titleMatch = text.match(/<title>(.*?)<\/title>/i);
    throw new Error(
      `Zoho returned HTML page${titleMatch ? ` ("${titleMatch[1]}")` : ""}. ` +
      "Ensure the report has public access ON and the view ID is correct."
    );
  }

  return text;
}

// ── Robust CSV parser ─────────────────────────────────────────────────────────
// Handles BOM, CRLF, quoted fields containing commas
function parseCsv(csvText) {
  const lines = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  return lines.map((line) => {
    const cells = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
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

    console.log("[zoho-stock] CSV headers found:", csvHeaders);

    const skuIndex = csvHeaders.findIndex(
      (h) => h.trim().toUpperCase() === COL_SKU.toUpperCase()
    );
    if (skuIndex === -1) {
      throw new Error(
        `CSV missing column "${COL_SKU}". Columns found: ${csvHeaders.join(" | ")}`
      );
    }

    const matchingRows = rows.filter(
      (row, i) =>
        i > 0 &&
        String(row[skuIndex] || "").trim().toUpperCase() === sku
    );

    console.log(`[zoho-stock] SKU "${sku}" matched ${matchingRows.length} row(s)`);

    const cities = {};
    CITIES.forEach((city) => {
      const cityIndex = csvHeaders.findIndex(
        (h) => h.trim().toLowerCase() === city.toLowerCase()
      );
      cities[city] =
        cityIndex !== -1 &&
        matchingRows.some(
          (row) => String(row[cityIndex] || "").trim().toLowerCase() === "available"
        );
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sku, cities }),
    };

  } catch (error) {
    console.error("[zoho-stock] Error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch stock", detail: error.message }),
    };
  }
};
