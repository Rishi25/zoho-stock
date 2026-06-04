// netlify/functions/zoho-stock.js

const COL_SKU         = "SKU";
const CITIES          = ["Ahmedabad", "Chandigarh"];
const DEFAULT_VIEW_ID = "1908942000009542263";

async function getZohoAccessToken() {
  const clientId     = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const accountsHost = process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.in";

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN");
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    "refresh_token",
  });

  const response = await fetch(`https://${accountsHost}/oauth/v2/token`, {
    method: "POST",
    body: params,
  });

  const data = await response.json();
  //console.log("[zoho-stock] Token response:", JSON.stringify(data));
  console.log("[zoho-stock] Token generated successfully");
  
  if (!data.access_token) {
    throw new Error(`Token error: ${data.error || JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function fetchZohoCsv() {
  const orgId       = process.env.ZOHO_ORG_ID;
  const workspaceId = process.env.ZOHO_WORKSPACE_ID;
  const viewId      = process.env.ZOHO_VIEW_ID || DEFAULT_VIEW_ID;
  const apiHost     = process.env.ZOHO_ANALYTICS_HOST || "analyticsapi.zoho.in";

  if (!orgId || !workspaceId) {
    throw new Error("Missing env vars: ZOHO_ORG_ID, ZOHO_WORKSPACE_ID");
  }

  const accessToken = await getZohoAccessToken();
  const config = encodeURIComponent(JSON.stringify({ responseFormat: "csv" }));
  const url = `https://${apiHost}/restapi/v2/workspaces/${workspaceId}/views/${viewId}/data?CONFIG=${config}`;

  console.log("[zoho-stock] Fetching:", url);

  const response = await fetch(url, {
    headers: {
      "Authorization":    `Zoho-oauthtoken ${accessToken}`,
      "ZANALYTICS-ORGID": orgId,
    },
  });

  const csvText = await response.text();
  console.log("[zoho-stock] API status:", response.status);
  console.log("[zoho-stock] First 300 chars:", csvText.slice(0, 300));

  if (!response.ok) {
    throw new Error(`API error (${response.status}): ${csvText.slice(0, 200)}`);
  }
  if (csvText.toLowerCase().includes("<html")) {
    throw new Error("Zoho returned HTML — check ZOHO_WORKSPACE_ID and ZOHO_VIEW_ID");
  }

  return csvText;
}

function parseCsv(csvText) {
  const lines = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  return lines.map((line) => {
    const cells = []; let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQuote && line[i+1] === '"') { cur += '"'; i++; } else inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

exports.handler = async (event) => {
  const sku = String(event.queryStringParameters?.sku || "").trim().toUpperCase();

  const headers = {
    "Access-Control-Allow-Origin":  "https://mortantra.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type":                 "application/json",
    "Cache-Control":                "s-maxage=60, stale-while-revalidate",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (!sku) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing sku param" }) };

  try {
    const rows       = parseCsv(await fetchZohoCsv());
    const csvHeaders = rows[0];
    console.log("[zoho-stock] Columns:", csvHeaders);

    const skuIndex = csvHeaders.findIndex(h => h.trim().toUpperCase() === COL_SKU.toUpperCase());
    if (skuIndex === -1) throw new Error(`Column "${COL_SKU}" not found. Got: ${csvHeaders.join(" | ")}`);

    const matchingRows = rows.filter((row, i) =>
      i > 0 && String(row[skuIndex] || "").trim().toUpperCase() === sku
    );
    console.log(`[zoho-stock] SKU "${sku}" → ${matchingRows.length} row(s)`);

    const cities = {};
    CITIES.forEach(city => {
      const ci = csvHeaders.findIndex(h => h.trim().toLowerCase() === city.toLowerCase());
      cities[city] = ci !== -1 && matchingRows.some(
        row => String(row[ci] || "").trim().toLowerCase() === "available"
      );
    });

    return { statusCode: 200, headers, body: JSON.stringify({ sku, cities }) };

  } catch (err) {
    console.error("[zoho-stock] Error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch stock", detail: err.message }) };
  }
};
