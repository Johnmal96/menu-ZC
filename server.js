import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import dotenv from "dotenv";
import { google } from "googleapis";
import { load } from "cheerio";
import { Resvg } from "@resvg/resvg-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const saveFolder = process.env.SAVED_SVG_FOLDER || path.join(__dirname, "saved-svg");
const defaultSvgUrl = process.env.SVG_SOURCE_URL || "/assets/menu1.svg";

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/visibility", async (req, res) => {
  try {
    const svgUrl = String(req.query?.svgUrl || defaultSvgUrl).trim();
    const svg = await readSvgFromAssets(svgUrl);
    const svgIdMap = buildSvgIdMapFromSvg(svg);

    const [{ visibleIds, rawVisibleIds }, prices] = await Promise.all([fetchVisibleIdsFromSheet(svgIdMap), fetchPricesFromSheet()]);
    res.json({ visibleIds, rawVisibleIds, prices });
  } catch (error) {
    console.error("Failed to load visibility from sheet:", error);
    const message = String(error?.message || "Failed to load visibility.");
    if (message.includes("SVG_TOO_LARGE")) {
      return res.status(413).json({ error: message });
    }
    res.status(500).json({ error: "Failed to load visibility." });
  }
});

app.post("/api/save-svg", async (req, res) => {
  try {
    const wantsDownload = String(req.query?.download || "").trim() === "1";
    const svgPayload = req.body?.svg;
    const svgUrl = String(req.body?.svgUrl || "").trim();
    const visibleIds = Array.isArray(req.body?.visibleIds) ? req.body.visibleIds : [];

    let svg = "";

    if (svgPayload) {
      svg = String(svgPayload);
      if (!svg.trim().startsWith("<svg")) {
        return res.status(400).json({ error: "Invalid SVG payload." });
      }
    } else if (svgUrl) {
      svg = await readSvgFromAssets(svgUrl);

      const svgIdMap = buildSvgIdMapFromSvg(svg);
      const expandedVisibleIds = visibleIds.flatMap((id) => {
        const normalized = String(id || "").trim();
        if (!normalized) return [];
        if (svgIdMap.has(normalized)) return svgIdMap.get(normalized);
        return [normalized];
      });

      const prices = await fetchPricesFromSheet();
      svg = applyVisibilityToSvg(svg, expandedVisibleIds);
      svg = applyPricesToSvg(svg, prices);
    } else {
      return res.status(400).json({ error: "Missing SVG payload." });
    }

    await fs.mkdir(saveFolder, { recursive: true });
    const fileName = `svg-${Date.now()}.png`;
    const filePath = path.join(saveFolder, fileName);
    const resvg = new Resvg(svg, {
      background: "transparent",
    });
    const pngBuffer = resvg.render().asPng();
    await fs.writeFile(filePath, pngBuffer);

    if (wantsDownload) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("X-File-Name", fileName);
      return res.send(pngBuffer);
    }

    res.json({ ok: true, fileName });
  } catch (error) {
    console.error("Failed to save SVG:", error);
    const message = String(error?.message || "Failed to save SVG.");
    if (message.includes("SVG_TOO_LARGE")) {
      return res.status(413).json({ error: message });
    }
    res.status(500).json({ error: "Failed to save SVG." });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

async function readSvgFromAssets(svgUrl) {
  const normalizedUrl = String(svgUrl || "").trim();
  if (!normalizedUrl.startsWith("/assets/") || !normalizedUrl.toLowerCase().endsWith(".svg")) {
    throw new Error("Invalid SVG URL.");
  }

  const publicPath = path.join(__dirname, "public");
  const relativePath = normalizedUrl.replace(/^\/+/, "");
  const resolvedPath = path.join(publicPath, relativePath);
  const assetsPath = path.join(publicPath, "assets");

  if (!resolvedPath.startsWith(assetsPath)) {
    throw new Error("Invalid SVG URL.");
  }

  // Large SVGs (especially with embedded base64 images) can exceed V8's maximum string length
  // and crash the process with an OOM. Guard and give a clear error instead.
  const { size } = await fs.stat(resolvedPath);
  const sizeMb = Math.round(size / 1024 / 1024);
  if (sizeMb >= 270) {
    throw new Error(
      `SVG_TOO_LARGE: ${path.basename(resolvedPath)} is ${sizeMb}MB. ` +
        "Optimize the SVG (remove embedded images/base64, use linked images, or export optimized SVG) so it is smaller before loading/saving.",
    );
  }

  return fs.readFile(resolvedPath, "utf8");
}

async function fetchVisibleIdsFromSheet(svgIdMap) {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME;
  const rawRange = process.env.GOOGLE_SHEETS_RANGE || "A3:B";
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!svgIdMap || typeof svgIdMap.get !== "function") {
    throw new Error("Missing SVG id map.");
  }

  if (!sheetId || !apiKey) {
    throw new Error("Missing GOOGLE_SHEETS_ID or GOOGLE_API_KEY.");
  }

  const sheets = google.sheets({ version: "v4" });

  let range = rawRange;
  if (!rawRange.includes("!")) {
    let targetSheetName = String(sheetName || "").trim();
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      key: apiKey,
      fields: "sheets.properties.title",
    });
    const sheetTitles = (metadata.data.sheets || [])
      .map((sheet) => sheet.properties?.title)
      .filter(Boolean);

    if (!targetSheetName || !sheetTitles.includes(targetSheetName)) {
      targetSheetName = sheetTitles[0] || "";
    }

    if (!targetSheetName) {
      throw new Error("No sheet tabs found for the spreadsheet.");
    }

    range = `${formatSheetName(targetSheetName)}!${rawRange}`;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    key: apiKey,
  });

  const rows = response.data.values || [];

  const entries = rows
    .map((row, index) => {
      const valueA = String(row[0] || "").trim();
      const valueB = String(row[1] || "").trim();

      const idFromA = normalizeId(valueA);
      const idFromB = normalizeId(valueB);
      const isBooleanA = isBooleanLike(valueA);
      const isBooleanB = isBooleanLike(valueB);
      const isIdA = isIdLike(idFromA);
      const isIdB = isIdLike(idFromB);

      let id = idFromA;
      let visibleValue = valueB;

      if (isIdB && (isBooleanA || !isIdA)) {
        id = idFromB;
        visibleValue = valueA;
      }

      const visible = parseVisible(visibleValue);
      const rowNumber = index + 1;
      const idsForRow = expandRowToSvgIds(id, rowNumber, svgIdMap);
      return { id, ids: idsForRow, visible };
    })
    .filter((row) => row.visible);

  const rawVisibleIds = entries
    .map((row) => row.id)
    .filter((id) => String(id || "").trim());

  const visibleIds = entries
    .filter((row) => row.ids.length)
    .flatMap((row) => row.ids);

  return { visibleIds, rawVisibleIds };
}

async function fetchPricesFromSheet() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME;
  const rawRange = process.env.GOOGLE_SHEETS_PRICE_RANGE || "C3:C";
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!sheetId || !apiKey) {
    throw new Error("Missing GOOGLE_SHEETS_ID or GOOGLE_API_KEY.");
  }

  const sheets = google.sheets({ version: "v4" });

  let range = rawRange;
  if (!rawRange.includes("!")) {
    let targetSheetName = String(sheetName || "").trim();
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      key: apiKey,
      fields: "sheets.properties.title",
    });
    const sheetTitles = (metadata.data.sheets || [])
      .map((sheet) => sheet.properties?.title)
      .filter(Boolean);

    if (!targetSheetName || !sheetTitles.includes(targetSheetName)) {
      targetSheetName = sheetTitles[0] || "";
    }

    if (!targetSheetName) {
      throw new Error("No sheet tabs found for the spreadsheet.");
    }

    range = `${formatSheetName(targetSheetName)}!${rawRange}`;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    key: apiKey,
  });

  const rows = response.data.values || [];
  const prices = {};

  // rawRange starts at row 3 by default. Map row 3 => price1, row 4 => price2, ...
  rows.forEach((row, index) => {
    const rawValue = String(row?.[0] ?? "").trim();
    const value = formatZlotyPrice(rawValue);
    const priceIndex = index + 1;
    const key = `price${priceIndex}`;
    prices[key] = value;
  });

  return prices;
}

function formatZlotyPrice(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  // If the sheet already contains the currency, keep it.
  if (/\bz\s*ł\b/i.test(trimmed) || /\bzł\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} zł`;
}

function formatSheetName(name) {
  const trimmed = String(name || "").trim();
  const escaped = trimmed.replace(/'/g, "''");
  const needsQuotes = /[^A-Za-z0-9_]/.test(escaped);
  return needsQuotes ? `'${escaped}'` : escaped;
}

function normalizeId(value) {
  return String(value || "").trim().replace(/^#/, "");
}

function isBooleanLike(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "false" || normalized === "1" || normalized === "0" || normalized === "yes" || normalized === "no";
}

function isIdLike(value) {
  const normalized = String(value || "").trim();
  return /^[0-9]+(\.[0-9]+)*$/.test(normalized);
}

function parseVisible(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function applyVisibilityToSvg(svg, visibleIds) {
  const $ = load(svg, { xmlMode: true });
  const visibleSet = new Set((visibleIds || []).map((id) => String(id)));

  function parseStyle(style) {
    const raw = String(style || "").trim();
    if (!raw) return new Map();
    const entries = raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf(":");
        if (index === -1) return null;
        const key = part.slice(0, index).trim().toLowerCase();
        const value = part.slice(index + 1).trim();
        if (!key) return null;
        return [key, value];
      })
      .filter(Boolean);

    return new Map(entries);
  }

  function serializeStyle(styleMap) {
    if (!styleMap || styleMap.size === 0) return "";
    return Array.from(styleMap.entries())
      .map(([key, value]) => `${key}:${value}`)
      .join(";");
  }

  function removeClassToken(classValue, token) {
    const raw = String(classValue || "").trim();
    if (!raw) return "";
    const tokens = raw
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => value !== token);
    return tokens.join(" ");
  }

  $("*[id]").each((_, element) => {
    const id = String($(element).attr("id") || "");
    if (!isIdLike(id)) {
      return;
    }

    const isVisible = visibleSet.has(id);

    // Inline styles (e.g. style="display:none") override presentation attributes.
    // To make exports match the "visible IDs" logic, explicitly rewrite both.
    const styleMap = parseStyle($(element).attr("style"));
    if (isVisible) {
      styleMap.delete("display");
      styleMap.delete("visibility");
      $(element).attr("display", "inline");
      $(element).attr("visibility", "visible");

      const nextClass = removeClassToken($(element).attr("class"), "hide");
      if (nextClass) {
        $(element).attr("class", nextClass);
      } else {
        $(element).removeAttr("class");
      }
    } else {
      styleMap.set("display", "none");
      $(element).attr("display", "none");
    }

    const serialized = serializeStyle(styleMap);
    if (serialized) {
      $(element).attr("style", serialized);
    } else {
      $(element).removeAttr("style");
    }
  });
  return $.xml();
}

function applyPricesToSvg(svg, prices) {
  const $ = load(svg, { xmlMode: true });
  const entries = Object.entries(prices || {});

  for (const [id, value] of entries) {
    const selector = `#${cssEscapeId(id)}`;
    const element = $(selector);
    if (!element || element.length === 0) continue;

    // In Inkscape, <text> usually contains <tspan>. Setting .text() updates all text children.
    element.text(String(value ?? ""));
  }

  return $.xml();
}

function cssEscapeId(id) {
  // Minimal escaping for CSS id selectors (sufficient for ids like price1, price2, ...)
  return String(id).replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
}

function buildSvgIdMapFromSvg(svg) {
  const $ = load(svg, { xmlMode: true });
  const map = new Map();

  // IDs like 1.1 may live on <rect>, <text>, etc. Not only <g>.
  $("*[id]").each((_, element) => {
    const id = String($(element).attr("id") || "");
    if (!isIdLike(id)) return;

    const [base] = id.split(".");
    if (!base) return;

    if (!map.has(base)) {
      map.set(base, []);
    }
    map.get(base).push(id);
  });

  for (const [key, list] of map.entries()) {
    list.sort((a, b) => {
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);
      const len = Math.max(aParts.length, bParts.length);
      for (let i = 0; i < len; i += 1) {
        const av = aParts[i] || 0;
        const bv = bParts[i] || 0;
        if (av !== bv) return av - bv;
      }
      return 0;
    });
  }

  return map;
}

function expandRowToSvgIds(rawId, rowNumber, svgIdMap) {
  const normalized = String(rawId || "").trim();
  const rowKey = String(rowNumber);

  if (normalized && svgIdMap.has(normalized)) {
    return svgIdMap.get(normalized);
  }

  if (svgIdMap.has(rowKey)) {
    return svgIdMap.get(rowKey);
  }

  if (normalized && isIdLike(normalized)) {
    return [normalized];
  }

  return [];
}
