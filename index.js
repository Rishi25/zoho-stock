// netlify/functions/zoho-stock.js

const ZOHO_REPORT_URL = "https://analytics.zoho.com/open-view/1908942000009542263";

const COL_SKU = "SKU";
const CITIES = ["Ahmedabad", "Chandigarh"];

exports.handler = async (event) => {
  const sku = String(event.queryStringParameters?.sku || "").trim().toUpperCase();

  const headers = {
    "Access-Control-Allow-Origin": "https://mortantra.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "s-maxage=60, stale-while-revalidate"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const zohoUrl = `${ZOHO_REPORT_URL}?exportType=csv`;

    const response = await fetch(zohoUrl);
    const csvText = await response.text();

    if (csvText.toLowerCase().includes("<html")) {
      throw new Error("Zoho returned HTML, not CSV");
    }

    const rows = csvText.trim().split(/\r?\n/).map(row =>
      row.split(",").map(cell =>
        cell.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim()
      )
    );

    const csvHeaders = rows[0];
    const skuIndex = csvHeaders.indexOf(COL_SKU);

    const matchingRows = rows.filter((row, index) =>
      index > 0 &&
      String(row[skuIndex] || "").trim().toUpperCase() === sku
    );

    const cities = {};

    CITIES.forEach(city => {
      const cityIndex = csvHeaders.indexOf(city);

      cities[city] = matchingRows.some(row =>
        String(row[cityIndex] || "").trim().toLowerCase() === "available"
      );
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sku,
        cities
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch stock",
        detail: error.message
      })
    };
  }
};
