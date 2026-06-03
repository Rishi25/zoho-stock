const COL_SKU = "SKU";
const CITIES = ["Ahmedabad", "Chandigarh"];
const DEFAULT_VIEW_ID = "1908942000009542263";

async function getZohoAccessToken() {
  const clientId = process.env.1000.C9ZC9FTUB792YNG2W0RD45SN55MZIO;
  const clientSecret = process.env.c4ae6912dd378c1091787f058367562b8408e572a3;
  const refreshToken = process.env.1000.838a33d60ba2e0195a15fa9a410e5525.7e0327fdc932cee11edb29148e51724b;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Zoho OAuth env vars. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in Netlify."
    );
  }

  const accountsHost = process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(`https://${accountsHost}/oauth/v2/token?${params}`, {
    method: "POST",
  });
  const data = await response.json();

  if (!data.access_token) {
    throw new Error(data.error || "Failed to refresh Zoho access token");
  }

  return data.access_token;
}

async function fetchZohoCsv() {
  const orgId = process.env.683701067;
  const workspaceId = process.1908942000000010004;
  const viewId = process.env.ZOHO_VIEW_ID || DEFAULT_VIEW_ID;

  if (!orgId || !workspaceId) {
    throw new Error(
      "Missing Zoho Analytics env vars. Set ZOHO_ORG_ID and ZOHO_WORKSPACE_ID in Netlify."
    );
  }

  const accessToken = await getZohoAccessToken();
  const config = encodeURIComponent(JSON.stringify({ responseFormat: "csv" }));
  const apiHost = process.env.ZOHO_ANALYTICS_HOST || "analyticsapi.zoho.com";
  const url = `https://${apiHost}/restapi/v2/workspaces/${workspaceId}/views/${viewId}/data?CONFIG=${config}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      ZANALYTICS-ORGID: orgId,
    },
  });

  const csvText = await response.text();

  if (!response.ok) {
    throw new Error(`Zoho Analytics API error (${response.status}): ${csvText.slice(0, 200)}`);
  }

  if (csvText.toLowerCase().includes("<html")) {
    throw new Error("Zoho returned HTML instead of CSV");
  }

  return csvText;
}

function parseCsv(csvText) {
  return csvText.trim().split(/\r?\n/).map((row) =>
    row.split(",").map((cell) =>
      cell.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim()
    )
  );
}

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
      throw new Error(`CSV is missing required column: ${COL_SKU}`);
    }

    const matchingRows = rows.filter(
      (row, index) =>
        index > 0 &&
        String(row[skuIndex] || "").trim().toUpperCase() === sku
    );

    const cities = {};

    CITIES.forEach((city) => {
      const cityIndex = csvHeaders.indexOf(city);
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
