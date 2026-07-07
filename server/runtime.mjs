import { createServer } from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";

const PORT = Number(process.env.PORT || 3001);
const LAT = Number(process.env.LATITUDE || "40.04375215857617");
const LON = Number(process.env.LONGITUDE || "0.0651749140667065");
const AEMET_API_KEY = process.env.AEMET_API_KEY || "";
const AEMET_TARGET_ZONE_CODES = (process.env.AEMET_TARGET_ZONE_CODES || "771204").split(",").map((s) => s.trim()).filter(Boolean);
const AEMET_TARGET_KEYWORDS = (
  process.env.AEMET_TARGET_KEYWORDS ||
  "Litoral Sur Castellón,Litoral Sur de Castellón,Litoral Sur Castellón - Costa"
).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const WINDY_API_KEY = process.env.WINDY_API_KEY || "";
const WINDGURU_STATIONS_URL = process.env.WINDGURU_STATIONS_URL || "https://stations.windguru.cz/data_api.php";
const WINDGURU_UID = process.env.WINDGURU_UID || "";
const WINDGURU_PASSWORD = process.env.WINDGURU_PASSWORD || "";
const WINDGURU_STATION_IDS = (process.env.WINDGURU_STATION_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AEMET_RSS_FEEDS = (
  process.env.AEMET_RSS_FEEDS ||
  "https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAZ771204_RSS.xml,https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAP7712_RSS.xml"
).split(",").map((s) => s.trim()).filter(Boolean);
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
const WHATSAPP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "en_US";
const WHATSAPP_TEST_TO = process.env.WHATSAPP_TEST_TO || "";
const AVAMET_PRIMARY_IDS = ["c05m028e05", "c05m028e09"]; // Voramar + Heliópolis
const AVAMET_AROUND_RADIUS_KM = Number(process.env.AVAMET_AROUND_RADIUS_KM || 20);
const AVAMET_MAP_IDS = ["c05m028e05", "c05m028e09", "c05m085e03", "c05m028e07", "c05m085e04", "c05m040e19"];
const AEMET_PLAYA_ID = "1202802"; // fijo Benicàssim
const AEMET_VIS_STATION_ID = "8500A"; // Castellón-Almassora
const WA_AUTO_SEND_ENABLED = String(process.env.WA_AUTO_SEND_ENABLED || "true").toLowerCase() === "true";
const WA_AUTO_SEND_INTERVAL_MS = Math.max(60000, Number(process.env.WA_AUTO_SEND_INTERVAL_MS || 180000));
const WA_CLIENT_ID = process.env.WA_CLIENT_ID || "cvb-group-list-temp";
const WA_GROUP_IDS = process.env.WA_GROUP_IDS || "";
const LIBSQL_URL = process.env.LIBSQL_URL || "";
const LIBSQL_AUTH_TOKEN = process.env.LIBSQL_AUTH_TOKEN || "";
const BUNNY_STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || "";
const BUNNY_STORAGE_PASSWORD = process.env.BUNNY_STORAGE_PASSWORD || "";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");
const SAMPLE_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 2 * 60 * 1000;
let LAST_AVAMET_BUNDLE = { around: [], primary: [], interpolation: null };
let INTERPOLATED_SAMPLES = [];
let AUTO_SEND_RUNNING = false;
let LAST_AUTO_DISPATCH = { at: null, alerts_seen: 0, sent: 0, error: null };
const SENT_ALERT_KEYS_FILE = join(root, "server", "sent-alert-keys.json");
let SENT_ALERT_KEYS = new Set();
const db = LIBSQL_URL && LIBSQL_AUTH_TOKEN
  ? createClient({ url: LIBSQL_URL, authToken: LIBSQL_AUTH_TOKEN })
  : null;

const toKn = (ms) => (typeof ms === "number" ? +(ms * 1.943844).toFixed(1) : null);
const kmhToKn = (kmh) => (typeof kmh === "number" ? +(kmh * 0.539957).toFixed(1) : null);
const round1 = (n) => (Number.isFinite(n) ? +Number(n).toFixed(1) : null);
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const getDirText = (deg = 0) => {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const FETCH_TIMEOUT_MS = 5000;

async function fetchJson(url, options = {}) {
  const signal = options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, { ...options, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchJsonRetry(url, options = {}, retries = 0) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchJson(url, options);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function htmlDecode(input = "") {
  return String(input)
    .replace(/&agrave;/g, "à").replace(/&egrave;/g, "è").replace(/&ograve;/g, "ò")
    .replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&ntilde;/g, "ñ")
    .replace(/&ccedil;/g, "ç").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function fetchText(url, options = {}) {
  const signal = options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, { ...options, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function initDb() {
  if (!db) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wind_samples (
      ts INTEGER PRIMARY KEY,
      wind REAL,
      gust REAL,
      dir REAL,
      temp REAL,
      humidity INTEGER,
      pressure INTEGER
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS alert_dispatches (
      alert_key TEXT PRIMARY KEY,
      sent_at INTEGER NOT NULL,
      area TEXT,
      level TEXT,
      phenomenon TEXT,
      valid_from TEXT,
      valid_to TEXT
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_wind_samples_ts ON wind_samples(ts)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_alert_dispatches_sent_at ON alert_dispatches(sent_at)");
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function parseTarFromGzipBuffer(gzipBuffer) {
  // Accept both .tar.gz (RSS feeds) and plain .tar (opendata API)
  const isGzip = gzipBuffer[0] === 0x1f && gzipBuffer[1] === 0x8b;
  const buf = isGzip ? gunzipSync(gzipBuffer) : gzipBuffer;
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    if (!name) break;
    const sizeOct = header.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim();
    const size = parseInt(sizeOct || "0", 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    entries.push({ name, content: buf.subarray(dataStart, dataEnd).toString("utf8") });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function parseCapXmlToAlerts(xml) {
  // Guards on root <alert>: ignore tests, drafts and cancellations
  const status = getTag(xml, "status");
  const msgType = getTag(xml, "msgType");
  if (status && status !== "Actual") return [];
  if (msgType === "Cancel") return [];
  const identifier = getTag(xml, "identifier");

  const infoBlocks = [...xml.matchAll(/<info[\s\S]*?<\/info>/gi)].map((m) => m[0]);
  const alerts = [];
  for (const block of infoBlocks) {
    // AEMET publishes each aviso in es-ES and en-GB — keep only Spanish
    const language = getTag(block, "language");
    if (language && !language.toLowerCase().startsWith("es")) continue;

    const severity = getTag(block, "severity");
    const sev = String(severity || "").toLowerCase();
    const level = sev.includes("extreme")
      ? "rojo"
      : sev.includes("severe")
        ? "naranja"
        : sev.includes("moderate")
          ? "amarillo"
          : "verde";
    // Minor = verde = "no risk" bulletins, never worth relaying
    if (level === "verde") continue;

    const expires = getTag(block, "expires");
    if (expires && new Date(expires).getTime() < Date.now()) continue;

    const event = getTag(block, "event");
    const description = getTag(block, "description");
    const effective = getTag(block, "effective");
    const onset = getTag(block, "onset");
    const headline = getTag(block, "headline");
    const certainty = getTag(block, "certainty");
    if (!event && !description) continue;

    // One alert per <area>: multi-zone bulletins carry several areas per <info>
    const areaBlocks = [...block.matchAll(/<area>[\s\S]*?<\/area>/gi)].map((m) => m[0]);
    for (const ab of areaBlocks.length ? areaBlocks : [block]) {
      const areaDesc = getTag(ab, "areaDesc");
      const areaCode = ((ab.match(/<geocode>[\s\S]*?<\/geocode>/i) || [])[0]?.match(/<value>(\w+)<\/value>/i) || [])[1] || "";
      alerts.push({
        id: `${identifier || "cap"}-${areaCode || Math.random().toString(36).slice(2, 8)}`,
        level,
        levelLabel: severity || "Aviso",
        phenomenon: event || "Aviso meteorológico",
        area: areaDesc || "Castellón",
        areaCode,
        description: htmlDecode(description || headline || ""),
        validFrom: onset || effective || new Date().toISOString(),
        validTo: expires || new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        source: "AEMET RSS/CAP",
        certainty: certainty || "",
      });
    }
  }
  return alerts;
}

async function fetchAemetAlertsFromRssCap(filtered = true) {
  const allAlerts = [];
  for (const rssUrl of AEMET_RSS_FEEDS) {
    try {
      const rss = await fetchText(rssUrl);
      const tarLink = getTag(rss, "link").includes(".tar.gz")
        ? getTag(rss, "link")
        : ((rss.match(/<link>(https?:\/\/[^<]+\.tar\.gz)<\/link>/i) || [])[1] || "");
      if (!tarLink) continue;
      const resp = await fetch(tarLink, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const gzBuf = Buffer.from(await resp.arrayBuffer());
      const files = parseTarFromGzipBuffer(gzBuf).filter((f) => f.name.toLowerCase().endsWith(".xml"));
      for (const f of files) allAlerts.push(...parseCapXmlToAlerts(f.content));
    } catch {
      // ignore per feed and continue
    }
  }
  return filtered ? allAlerts.filter((a) => isInTargetAemetZone(a)) : allAlerts;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function sendWhatsAppTemplate({ to, templateName, langCode, components }) {
  const endpoint = `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: langCode },
    },
  };
  if (Array.isArray(components) && components.length) {
    payload.template.components = components;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `WhatsApp HTTP ${response.status}`);
  }
  return data;
}

async function sendWhatsAppText({ to, text }) {
  const endpoint = `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `WhatsApp HTTP ${response.status}`);
  }
  return data;
}

async function fetchAemetAlerts() {
  // Official opendata API. Area 77 = Comunitat Valenciana; "datos" is a plain
  // tar of the same CAP XMLs the RSS feeds carry, so both paths share one parser.
  if (!AEMET_API_KEY) return [];
  try {
    const idx = await fetchJson("https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/77", { headers: { api_key: AEMET_API_KEY } });
    if (!idx?.datos) return [];
    const resp = await fetch(idx.datos, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const buf = Buffer.from(await resp.arrayBuffer());
    const files = parseTarFromGzipBuffer(buf).filter((f) => f.name.toLowerCase().endsWith(".xml"));
    const alerts = files.flatMap((f) => parseCapXmlToAlerts(f.content));
    return alerts.filter((a) => isInTargetAemetZone(a)).map((a) => ({ ...a, source: "AEMET API" }));
  } catch {
    return [];
  }
}

async function fetchWindguruNearest() {
  if (!WINDGURU_UID || !WINDGURU_PASSWORD || !WINDGURU_STATION_IDS.length) {
    return { nearest: null, wind: null, gust: null, dir: null };
  }
  try {
    const rows = [];
    for (const id of WINDGURU_STATION_IDS) {
      const u = new URL("https://www.windguru.cz/int/wgsapi.php");
      u.searchParams.set("q", "station_data_current");
      u.searchParams.set("id_station", id);
      u.searchParams.set("uid", WINDGURU_UID);
      u.searchParams.set("password", WINDGURU_PASSWORD);
      const raw = await fetchJson(u.toString());
      if (raw?.return === "error") continue;
      const lat = Number(raw?.lat);
      const lon = Number(raw?.lon);
      rows.push({
        id,
        name: raw?.station_name || raw?.name || `WG ${id}`,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        wind: Number(raw?.wind_avg ?? raw?.wind ?? raw?.wind_speed),
        gust: Number(raw?.wind_max ?? raw?.gust),
        dir: Number(raw?.wind_direction ?? raw?.wind_dir ?? raw?.dir),
      });
    }
    const withCoord = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    const candidates = withCoord.length ? withCoord : rows;
    if (!candidates.length) return { nearest: null, wind: null, gust: null, dir: null };
    let nearest = null;
    for (const s of candidates) {
      const d = Number.isFinite(s.lat) && Number.isFinite(s.lon) ? haversineKm(LAT, LON, s.lat, s.lon) : 99999;
      if (!nearest || d < nearest.distanceKm) nearest = { station: s, distanceKm: d };
    }
    const wind = Number(nearest.station.wind);
    const gust = Number(nearest.station.gust);
    const dir = Number(nearest.station.dir);
    return {
      nearest,
      wind: Number.isFinite(wind) ? +wind.toFixed(1) : null,
      gust: Number.isFinite(gust) ? +gust.toFixed(1) : null,
      dir: Number.isFinite(dir) ? dir : null,
    };
  } catch {
    return { nearest: null, wind: null, gust: null, dir: null };
  }
}

async function fetchWindyPoint() {
  if (!WINDY_API_KEY) return { wind: null, gust: null, dir: null };
  try {
    const data = await fetchJson("https://api.windy.com/api/point-forecast/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: LAT, lon: LON, model: "ecmwf", parameters: ["wind", "gust", "windDir"], levels: ["surface"], key: WINDY_API_KEY }),
    });
    const one = (v) => (Array.isArray(v) && v.length ? Number(v[0]) : Number.isFinite(v) ? Number(v) : null);
    return { wind: toKn(one(data.wind ?? data["wind-surface"])), gust: toKn(one(data.gust ?? data["gust-surface"])), dir: one(data.windDir ?? data["windDir-surface"]) };
  } catch {
    return { wind: null, gust: null, dir: null };
  }
}

async function fetchOpenMeteo() {
  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&daily=wind_speed_10m_max,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min&timezone=Europe/Madrid&forecast_days=7`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&current=wave_height,sea_surface_temperature&hourly=wave_height,wave_period`;
  const [meteo, marine] = await Promise.all([fetchJson(meteoUrl), fetchJson(marineUrl)]);
  return { meteo, marine };
}

function avgNumeric(values = []) {
  const list = values.filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  return round1(list.reduce((a, b) => a + b, 0) / list.length);
}

function parseWaveHeightFromAemetText(text = "") {
  const matches = [...String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*(?:a|-)\s*(\d+(?:[.,]\d+)?)\s*m/gi)];
  if (matches.length) {
    const vals = matches.map((m) => Number(String(m[2]).replace(",", "."))).filter(Number.isFinite);
    if (vals.length) return Math.max(...vals);
  }
  const one = String(text).match(/(\d+(?:[.,]\d+)?)\s*m/);
  if (one) {
    const v = Number(String(one[1]).replace(",", "."));
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function parseVisibilityFromAemetText(text = "") {
  const t = String(text).toLowerCase();
  if (t.includes("muy buena")) return "Muy buena";
  if (t.includes("buena")) return "Buena";
  if (t.includes("regular")) return "Regular";
  if (t.includes("mala")) return "Mala";
  if (t.includes("muy mala")) return "Muy mala";
  return "No especificada";
}

function visibilityFromMeters(meters) {
  if (!Number.isFinite(meters)) return "No disponible";
  const km = meters / 1000;
  if (km >= 10) return "Muy buena";
  if (km >= 5) return "Buena";
  if (km >= 2) return "Regular";
  return "Mala";
}

function visibilityFromAemetVv(vvKm) {
  if (!Number.isFinite(vvKm)) return "No disponible";
  if (vvKm >= 10) return "Muy buena";
  if (vvKm >= 5) return "Buena";
  if (vvKm >= 2) return "Regular";
  return "Mala";
}

function circularMeanDeg(values = []) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  const sin = vals.reduce((a, v) => a + Math.sin((v * Math.PI) / 180), 0) / vals.length;
  const cos = vals.reduce((a, v) => a + Math.cos((v * Math.PI) / 180), 0) / vals.length;
  const deg = (Math.atan2(sin, cos) * 180) / Math.PI;
  return (deg + 360) % 360;
}

async function fetchAemetMaritimeCastellon() {
  const out = {
    source: "AEMET oficial (playa+marítima+obs)",
    text: "",
    waveHeight: null,
    visibility: "No especificada",
    seaTemp: null,
  };
  try {
    if (AEMET_API_KEY) {
      const idxPlaya = await fetchJsonRetry(
        `https://opendata.aemet.es/opendata/api/prediccion/especifica/playa/${AEMET_PLAYA_ID}`,
        { headers: { api_key: AEMET_API_KEY } },
      );
      if (idxPlaya?.datos) {
        const beach = await fetchJsonRetry(idxPlaya.datos, { headers: { "User-Agent": "Mozilla/5.0" } });
        const day = Array.isArray(beach) ? beach?.[0]?.prediccion?.dia?.[0] : null;
        const tAgua = Number(day?.tAgua?.valor1 ?? day?.tagua?.valor1);
        if (Number.isFinite(tAgua)) out.seaTemp = tAgua;
        const oleDesc = String(day?.oleaje?.descripcion2 || day?.oleaje?.descripcion1 || "").trim();
        if (oleDesc) out.text = out.text ? `${out.text} ${oleDesc}` : oleDesc;
      }

      const idxObs = await fetchJsonRetry(
        `https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/${AEMET_VIS_STATION_ID}`,
        { headers: { api_key: AEMET_API_KEY } },
      );
      if (idxObs?.datos) {
        const obs = await fetchJsonRetry(idxObs.datos, { headers: { "User-Agent": "Mozilla/5.0" } });
        const vv = Number(Array.isArray(obs) ? obs?.[0]?.vv : null); // km horizontal visibility
        out.visibility = visibilityFromAemetVv(vv);
      }
    }

    const html = await fetchText("https://www.aemet.es/es/eltiempo/prediccion/maritima?area=val1&opc1=0&opc3=1");
    const blockMatch = html.match(/Aguas costeras de Castell[\s\S]*?<div>([\s\S]*?)<\/div>/i);
    const text = blockMatch ? htmlDecode(blockMatch[1]) : "";
    out.text = out.text ? `${out.text} ${text}`.trim() : text;
    out.waveHeight = parseWaveHeightFromAemetText(text);
    if (!out.visibility || out.visibility === "No especificada") {
      out.visibility = parseVisibilityFromAemetText(text);
    }
    return out;
  } catch {
    return out;
  }
}

function contentType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

async function alertHistoryFromDb(limit = 30) {
  // History = avisos this system actually dispatched (alert_dispatches table).
  // The opendata "archivo" endpoint is a multi-MB national tar capped at 2 days — not worth polling.
  if (!db) return [];
  try {
    const r = await db.execute({
      sql: "SELECT alert_key, sent_at, area, level, phenomenon, valid_from, valid_to FROM alert_dispatches ORDER BY sent_at DESC LIMIT ?",
      args: [limit],
    });
    return (r.rows || []).map((row, i) => ({
      id: String(row.alert_key || `hist-${i}`),
      level: String(row.level || "amarillo"),
      levelLabel: `Aviso ${String(row.level || "")}`.trim(),
      phenomenon: String(row.phenomenon || "Aviso meteorológico"),
      area: String(row.area || "Litoral sur de Castellón"),
      description: `Aviso enviado a los grupos el ${formatMadridDateTime(new Date(Number(row.sent_at)))}`,
      validFrom: String(row.valid_from || ""),
      validTo: String(row.valid_to || ""),
      source: "Historial CVB",
    }));
  } catch {
    return [];
  }
}

function isInTargetAemetZone(alert) {
  // Primary: official AEMET zone code from the geocode element
  if (alert.areaCode && AEMET_TARGET_ZONE_CODES.some((c) => alert.areaCode === c)) return true;
  // Fallback: keyword match (covers missing or higher-level geocodes).
  // Word-by-word matching only against the zone name — matching words inside the
  // description would let e.g. "viento del sur" leak alerts from other zones.
  const areaName = String(alert.area || "").toLowerCase();
  const haystack = `${areaName} ${String(alert.description || "").toLowerCase()}`;
  return AEMET_TARGET_KEYWORDS.some(
    (k) => haystack.includes(k) || k.split(/\s+/).every((w) => areaName.includes(w))
  );
}

async function fetchCastellonStations() {
  if (!AEMET_API_KEY) return [];
  try {
    const idx = await fetchJson(
      "https://opendata.aemet.es/opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones",
      { headers: { api_key: AEMET_API_KEY } }
    );
    if (!idx?.datos) return [];
    const all = await fetchJson(idx.datos);
    const stations = Array.isArray(all) ? all : [];

    const parseCoord = (raw, isLat) => {
      if (!raw || typeof raw !== "string") return null;
      const v = raw.trim().toUpperCase();
      const hemi = v.slice(-1);
      const num = v.slice(0, -1);
      if (!/^\d+$/.test(num)) return null;
      const degDigits = isLat ? 2 : 3;
      const deg = Number(num.slice(0, degDigits));
      const min = Number(num.slice(degDigits, degDigits + 2));
      const sec = Number(num.slice(degDigits + 2, degDigits + 4));
      let dec = deg + min / 60 + sec / 3600;
      if (hemi === "S" || hemi === "W") dec *= -1;
      return dec;
    };

    const castellon = stations
      .filter((s) => String(s?.provincia || "").toUpperCase().includes("CASTELL"))
      .map((s) => ({
        id: String(s?.indicativo || s?.nombre || Math.random()),
        name: String(s?.nombre || "Estación"),
        lat: parseCoord(s?.latitud, true),
        lon: parseCoord(s?.longitud, false),
        wind: null,
        gust: null,
        dir: null,
        temp: null,
        humidity: null,
        source: "AEMET inventario estaciones",
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));

    return castellon.slice(0, 40);
  } catch {
    return [];
  }
}

async function fetchAvametBenicasimStations() {
  try {
    // Primary: read from Bunny Storage cache (updated every 5 min by GitHub Actions)
    // Fallback: fetch AVAMET directly (works in dev, may timeout in MC)
    let data;
    if (BUNNY_STORAGE_ZONE && BUNNY_STORAGE_PASSWORD) {
      const cacheUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/state/avamet-cache.json`;
      const cacheRes = await fetch(cacheUrl, {
        headers: { AccessKey: BUNNY_STORAGE_PASSWORD },
        signal: AbortSignal.timeout(8000),
      });
      if (cacheRes.ok) {
        data = await cacheRes.json();
      }
    }
    if (!data) {
      data = await fetchJsonRetry("https://www.avamet.org/mxo-i-2023.json", {
        signal: AbortSignal.timeout(15000),
        headers: { "Accept-Encoding": "gzip, deflate, br", "User-Agent": "CVB-Meteo/1.0" },
      }, 1);
    }
    const rows = Array.isArray(data) ? data : [];
    const around = rows
      .map((row) => {
        const lat = Number(row.lati);
        const lon = Number(row.logi);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const distKm = haversineKm(LAT, LON, lat, lon);
        if (distKm > AVAMET_AROUND_RADIUS_KM) return null;
        const windKmh = Number(row.vent);
        const gustKmh = Number(row.vent_max);
        const temp = Number(row.temp);
        const humidity = Number(row.hrel);
        const pressure = Number(row.pres);
        const dir = Number(row.vent_dir);
        return {
          id: String(row.esta || ""),
          name: htmlDecode(row.nomd || "Estación AVAMET"),
          lat,
          lon,
          distKm: +distKm.toFixed(1),
          wind: Number.isFinite(windKmh) ? kmhToKn(windKmh) : null,
          gust: Number.isFinite(gustKmh) ? kmhToKn(gustKmh) : null,
          dir: Number.isFinite(dir) ? dir : null,
          temp: Number.isFinite(temp) ? temp : null,
          humidity: Number.isFinite(humidity) ? humidity : null,
          pressure: Number.isFinite(pressure) ? pressure : null,
          source: "AVAMET",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 60);

    const primary = around.filter((s) => AVAMET_PRIMARY_IDS.includes(s.id));
    const interpolation = primary.length
      ? {
          name: "Estación CVB interpolada (Voramar + Heliópolis)",
          wind: avgNumeric(primary.map((s) => s.wind)),
          gust: avgNumeric(primary.map((s) => s.gust)),
          dir: circularMeanDeg(primary.map((s) => s.dir)),
          temp: avgNumeric(primary.map((s) => s.temp)),
          humidity: avgNumeric(primary.map((s) => s.humidity)),
          pressure: avgNumeric(primary.map((s) => s.pressure)),
          source: "Interpolación AVAMET",
          satellites: primary.map((s) => ({ id: s.id, name: s.name })),
        }
      : null;

    const out = { around, primary, interpolation };
    if (around.length) LAST_AVAMET_BUNDLE = out;
    return out;
  } catch (e) {
    console.error("fetchAvametBenicasimStations error:", e?.message || e);
    return LAST_AVAMET_BUNDLE;
  }
}

async function pollInterpolatedSample() {
  try {
    const bundle = await fetchAvametBenicasimStations();
    const i = bundle?.interpolation;
    if (!i) return;
    const now = Date.now();
    INTERPOLATED_SAMPLES.push({
      ts: now,
      wind: round1(i.wind),
      gust: round1(i.gust),
      dir: round1(i.dir),
      temp: round1(i.temp),
      humidity: Number.isFinite(i.humidity) ? Math.round(i.humidity) : null,
      pressure: Number.isFinite(i.pressure) ? Math.round(i.pressure) : null,
    });
    const cutoff = now - SAMPLE_RETENTION_MS;
    INTERPOLATED_SAMPLES = INTERPOLATED_SAMPLES.filter((s) => s.ts >= cutoff);
    if (db) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO wind_samples (ts, wind, gust, dir, temp, humidity, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [now, round1(i.wind), round1(i.gust), round1(i.dir), round1(i.temp), Number.isFinite(i.humidity) ? Math.round(i.humidity) : null, Number.isFinite(i.pressure) ? Math.round(i.pressure) : null],
      });
      await db.execute({
        sql: `DELETE FROM wind_samples WHERE ts < ?`,
        args: [cutoff],
      });
    }
  } catch {
    // ignore polling errors
  }
}

const _madridHourFmt = new Intl.DateTimeFormat("sv", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
});
function madridHourKey(ts) {
  const parts = _madridHourFmt.formatToParts(new Date(ts));
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}`;
}

async function hourlyFromSamples() {
  if (db) {
    const now = Date.now();
    const start = now - (24 * 60 * 60 * 1000);
    const rowsRes = await db.execute({
      sql: `SELECT ts, wind, gust, dir FROM wind_samples WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`,
      args: [start, now],
    });
    const rows = rowsRes.rows || [];
    if (!rows.length) return [];
    const byHour = new Map();
    for (const r of rows) {
      const hourKey = madridHourKey(Number(r.ts));
      if (!byHour.has(hourKey)) byHour.set(hourKey, []);
      byHour.get(hourKey).push({
        wind: Number(r.wind),
        gust: Number(r.gust),
        dir: Number(r.dir),
      });
    }
    return [...byHour.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24)
      .map(([hourKey, list]) => ({
        time: `${hourKey.slice(11, 13)}:00`,
        wind: round1(avgNumeric(list.map((x) => x.wind)) ?? 0),
        gust: round1(Math.max(...list.map((x) => Number(x.gust || 0))) || 0),
        dir: round1(circularMeanDeg(list.map((x) => x.dir)) ?? 0),
      }));
  }

  const now = Date.now();
  const start = now - (24 * 60 * 60 * 1000);
  const windowSamples = INTERPOLATED_SAMPLES.filter((s) => s.ts >= start && s.ts <= now);
  if (!windowSamples.length) return [];
  const byHour = new Map();
  for (const s of windowSamples) {
    const hourKey = madridHourKey(s.ts);
    if (!byHour.has(hourKey)) byHour.set(hourKey, []);
    byHour.get(hourKey).push(s);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24)
    .map(([hourKey, list]) => ({
      time: `${hourKey.slice(11, 13)}:00`,
      wind: round1(avgNumeric(list.map((x) => x.wind)) ?? 0),
      gust: round1(Math.max(...list.map((x) => Number(x.gust || 0))) || 0),
      dir: round1(circularMeanDeg(list.map((x) => x.dir)) ?? 0),
    }));
}

function alertRank(level) {
  if (level === "rojo") return 4;
  if (level === "naranja") return 3;
  if (level === "amarillo") return 2;
  return 1;
}

function alertFingerprint(alert) {
  // Stable across AEMET re-publications (msgType=Update): zone + phenomenon + level + onset.
  // Deliberately excludes expires so extending an aviso doesn't re-notify;
  // an escalation (amarillo -> naranja) changes level and does notify again.
  // onset normalized to epoch so "+02:00" vs "Z" spellings of the same instant match.
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const zone = norm(alert?.areaCode || alert?.area);
  const phenomenon = norm(alert?.phenomenon);
  const level = norm(alert?.level);
  const fromTs = new Date(alert?.validFrom || "").getTime();
  const from = Number.isNaN(fromTs) ? norm(alert?.validFrom) : String(fromTs);
  return `${zone}__${phenomenon}__${level}__${from}`;
}

function formatMadridDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "-");
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function levelEmoji(level) {
  if (level === "rojo") return "🔴";
  if (level === "naranja") return "🟠";
  if (level === "amarillo") return "🟡";
  return "🟢";
}

function formatAlertWhatsappText(alert) {
  const nivel = String(alert.level || "-");
  return [
    "⚠️ Aviso meteorológico AEMET",
    `📍 Zona: ${String(alert.area || "-")}`,
    `${levelEmoji(alert.level)} Nivel ${nivel} · ${String(alert.phenomenon || "-")}`,
    `📝 ${String(alert.description || "Aviso oficial de AEMET")}`,
    `🕒 De ${formatMadridDateTime(alert.validFrom)} a ${formatMadridDateTime(alert.validTo)}`,
    "",
    "🔗 Portal meteo CVB:",
    "https://meteo.cvbenicasim.com",
  ].join("\n");
}

async function loadSentAlertKeys() {
  if (db) {
    try {
      const rowsRes = await db.execute("SELECT alert_key FROM alert_dispatches ORDER BY sent_at ASC LIMIT 5000");
      const keys = (rowsRes.rows || []).map((r) => String(r.alert_key)).filter(Boolean);
      SENT_ALERT_KEYS = new Set(keys);
      return;
    } catch {
      SENT_ALERT_KEYS = new Set();
    }
  }
  try {
    if (!existsSync(SENT_ALERT_KEYS_FILE)) return;
    const txt = await readFile(SENT_ALERT_KEYS_FILE, "utf8");
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) SENT_ALERT_KEYS = new Set(arr.filter(Boolean));
  } catch {
    SENT_ALERT_KEYS = new Set();
  }
}

async function saveSentAlertKeys() {
  if (db) return;
  try {
    const all = [...SENT_ALERT_KEYS];
    const kept = all.slice(-500);
    await writeFile(SENT_ALERT_KEYS_FILE, JSON.stringify(kept, null, 2), "utf8");
  } catch {
    // ignore
  }
}

async function sendAlertToGroups(groupIds, text) {
  const ids = Array.isArray(groupIds) ? groupIds.join(",") : groupIds;
  const env = {
    ...process.env,
    WA_CLIENT_ID,
    WA_GROUP_IDS: ids,
    WA_ALERT_MESSAGE: text,
  };
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "wa:send:groups"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (d) => process.stdout.write(String(d)));
    child.stderr.on("data", (d) => {
      stderr += String(d);
      process.stderr.write(String(d));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `wa:send:groups exit ${code}`));
    });
  });
}

async function sendAlertToConfiguredGroups(text) {
  await sendAlertToGroups(WA_GROUP_IDS, text);
}

async function autoDispatchAemetAlertsToGroups() {
  if (!WA_AUTO_SEND_ENABLED || AUTO_SEND_RUNNING) return;
  AUTO_SEND_RUNNING = true;
  try {
    const [apiAlerts, rssAlerts] = await Promise.all([fetchAemetAlerts(), fetchAemetAlertsFromRssCap()]);
    // Merge both sources and dedupe by fingerprint — they carry the same CAP avisos
    const byFp = new Map();
    for (const a of [...apiAlerts, ...rssAlerts]) {
      const fp = alertFingerprint(a);
      if (!byFp.has(fp)) byFp.set(fp, a);
    }
    const alerts = [...byFp.values()].sort((a, b) => alertRank(b.level) - alertRank(a.level));
    LAST_AUTO_DISPATCH = { at: new Date().toISOString(), alerts_seen: alerts.length, sent: 0, error: null };
    if (!alerts.length) return;

    for (const alert of alerts) {
      // Never relay verde/unknown levels or already-expired avisos
      if (alertRank(alert.level) < 2) continue;
      const expiresTs = new Date(alert.validTo || 0).getTime();
      if (expiresTs && expiresTs < Date.now()) continue;
      const fp = alertFingerprint(alert);
      if (SENT_ALERT_KEYS.has(fp)) continue;
      const text = formatAlertWhatsappText(alert);
      await sendAlertToConfiguredGroups(text);
      SENT_ALERT_KEYS.add(fp);
      LAST_AUTO_DISPATCH.sent += 1;
      if (db) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO alert_dispatches (alert_key, sent_at, area, level, phenomenon, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            fp,
            Date.now(),
            String(alert.area || ""),
            String(alert.level || ""),
            String(alert.phenomenon || ""),
            String(alert.validFrom || ""),
            String(alert.validTo || ""),
          ],
        });
        await db.execute({
          sql: `DELETE FROM alert_dispatches WHERE sent_at < ?`,
          args: [Date.now() - SAMPLE_RETENTION_MS],
        });
      }
      await saveSentAlertKeys();
    }
  } catch (err) {
    console.error("autoDispatchAemetAlertsToGroups error:", err?.message || err);
    LAST_AUTO_DISPATCH.error = String(err?.message || err);
  } finally {
    AUTO_SEND_RUNNING = false;
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) return json(res, 400, { ok: false, error: "bad request" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true });

    if (url.pathname === "/api/whatsapp/test-alert") {
      if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
        return json(res, 400, {
          ok: false,
          error: "missing_whatsapp_config",
          required: ["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
        });
      }
      const body = await parseBody(req);
      const to = String(body.to || WHATSAPP_TEST_TO || "").replace(/\s+/g, "");
      if (!to) {
        return json(res, 400, { ok: false, error: "missing_destination", hint: "send {\"to\":\"346...\"}" });
      }
      const mode = String(body.mode || "template").toLowerCase();
      let result;
      if (mode === "text") {
        const text = String(body.text || "Prueba alerta meteo CVB");
        result = await sendWhatsAppText({ to, text });
      } else {
        result = await sendWhatsAppTemplate({
          to,
          templateName: String(body.template_name || WHATSAPP_TEMPLATE_NAME),
          langCode: String(body.lang_code || WHATSAPP_TEMPLATE_LANG),
          components: Array.isArray(body.components) ? body.components : [],
        });
      }
      return json(res, 200, {
        ok: true,
        to,
        mode,
        message_id: result?.messages?.[0]?.id || null,
        status: result?.messages?.[0]?.message_status || "accepted",
      });
    }

    if (url.pathname === "/api/whatsapp/send-aemet-alert") {
      if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
        return json(res, 400, {
          ok: false,
          error: "missing_whatsapp_config",
          required: ["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
        });
      }
      const [apiAlerts, rssAlerts] = await Promise.all([fetchAemetAlerts(), fetchAemetAlertsFromRssCap()]);
      const sendByFp = new Map();
      for (const a of [...apiAlerts, ...rssAlerts]) {
        const fp = alertFingerprint(a);
        if (!sendByFp.has(fp)) sendByFp.set(fp, a);
      }
      const alerts = [...sendByFp.values()];
      if (!alerts.length) {
        return json(res, 404, {
          ok: false,
          error: "no_aemet_alerts_for_target_zones",
          target_keywords: AEMET_TARGET_KEYWORDS,
          target_codes: AEMET_TARGET_ZONE_CODES,
        });
      }
      const destination = WHATSAPP_TEST_TO || "34677025272";
      const sent = [];
      const sorted = [...alerts].sort((a, b) => alertRank(b.level) - alertRank(a.level));
      for (const alert of sorted) {
        const bodyParams = [
          { type: "text", text: String(alert.area || "-").slice(0, 1024) },
          { type: "text", text: String(alert.levelLabel || alert.level || "-").slice(0, 1024) },
          { type: "text", text: String(alert.phenomenon || "-").slice(0, 1024) },
          { type: "text", text: String(alert.description || "-").slice(0, 1024) },
          { type: "text", text: formatMadridDateTime(alert.validFrom).slice(0, 1024) },
          { type: "text", text: formatMadridDateTime(alert.validTo).slice(0, 1024) },
        ];
        const send = await sendWhatsAppTemplate({
          to: destination,
          templateName: WHATSAPP_TEMPLATE_NAME,
          langCode: WHATSAPP_TEMPLATE_LANG,
          components: [{ type: "body", parameters: bodyParams }],
        });
        sent.push({
          message_id: send?.messages?.[0]?.id || null,
          status: send?.messages?.[0]?.message_status || "accepted",
          area: alert.area,
          level: alert.level,
          phenomenon: alert.phenomenon,
          validFrom: alert.validFrom,
          validTo: alert.validTo,
        });
      }
      return json(res, 200, {
        ok: true,
        sent_count: sent.length,
        sent,
      });
    }

    if (url.pathname === "/api/whatsapp/force-test") {
      if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
        return json(res, 400, {
          ok: false,
          error: "missing_whatsapp_config",
          required: ["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
        });
      }
      const destination = WHATSAPP_TEST_TO || "34677025272";
      const [apiAll, rssAll] = await Promise.all([fetchAemetAlerts(), fetchAemetAlertsFromRssCap(false)]);
      const candidates = [...apiAll, ...rssAll];
      if (!candidates.length) {
        return json(res, 404, { ok: false, error: "no_aemet_alerts_available" });
      }
      const selected = [...candidates].sort((a, b) => alertRank(b.level) - alertRank(a.level))[0];
      const bodyParams = [
        { type: "text", text: String(selected.area || "-").slice(0, 1024) },
        { type: "text", text: String(selected.levelLabel || selected.level || "-").slice(0, 1024) },
        { type: "text", text: String(selected.phenomenon || "-").slice(0, 1024) },
        { type: "text", text: String(selected.description || "-").slice(0, 1024) },
        { type: "text", text: formatMadridDateTime(selected.validFrom).slice(0, 1024) },
        { type: "text", text: formatMadridDateTime(selected.validTo).slice(0, 1024) },
      ];
      const send = await sendWhatsAppTemplate({
        to: destination,
        templateName: WHATSAPP_TEMPLATE_NAME,
        langCode: WHATSAPP_TEMPLATE_LANG,
        components: [{ type: "body", parameters: bodyParams }],
      });
      return json(res, 200, {
        ok: true,
        forced: true,
        message_id: send?.messages?.[0]?.id || null,
        status: send?.messages?.[0]?.message_status || "accepted",
        sent_alert: {
          area: selected.area,
          level: selected.level,
          phenomenon: selected.phenomenon,
          validFrom: selected.validFrom,
          validTo: selected.validTo,
          source: selected.source || "AEMET",
        },
      });
    }

    if (url.pathname === "/api/whatsapp/start-qr") {
      const qrFile = "/tmp/wa-pending-qr.txt";
      try { await unlink(qrFile); } catch {}
      const env = { ...process.env, WA_CLIENT_ID, WA_QR_FILE: qrFile };
      const proc = spawn("node", ["server/wa-qr-server.mjs"], {
        cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
      });
      proc.stdout.on("data", (d) => process.stdout.write(String(d)));
      proc.stderr.on("data", (d) => process.stderr.write(String(d)));
      return json(res, 202, { ok: true, status: "qr_process_started", scan_url: "/api/whatsapp/qr" });
    }

    if (url.pathname === "/api/whatsapp/qr") {
      const qrFile = "/tmp/wa-pending-qr.txt";
      const qrString = existsSync(qrFile)
        ? await readFile(qrFile, "utf8").catch(() => null)
        : null;
      const html = `<!DOCTYPE html>
<html><head>
<title>CVB WhatsApp QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3">
<style>body{font-family:sans-serif;text-align:center;padding:20px;background:#111;color:#fff}h2{margin-bottom:20px}#qr{display:inline-block;background:#fff;padding:16px;border-radius:8px}</style>
</head><body>
${qrString
  ? `<h2>Escanea con WhatsApp → Dispositivos vinculados</h2>
<div id="qr"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById('qr'),{text:${JSON.stringify(qrString)},width:280,height:280,colorDark:'#000',colorLight:'#fff'})</script>
<p>Página se actualiza cada 3s. Cuando escanees desaparecerá el QR.</p>`
  : `<h2>Sin QR pendiente</h2><p>Llama a <code>POST /api/whatsapp/start-qr</code> primero,<br>o la sesión ya está vinculada.</p>`}
</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/whatsapp/wa-test") {
      const juntaId = WA_GROUP_IDS.split(",")[0].trim();
      if (!juntaId) {
        return json(res, 400, { ok: false, error: "WA_GROUP_IDS no configurado" });
      }
      json(res, 202, { ok: true, status: "sending", sent_to: juntaId });
      sendAlertToGroups(juntaId, "🧪 Prueba técnica meteo CVB — sistema OK")
        .then(() => console.log(`wa-test OK -> ${juntaId}`))
        .catch((err) => console.error(`wa-test ERROR: ${err?.message || err}`));
      return;
    }

    if (url.pathname === "/api/meteo") {
      const safe = (p, fallback) => p.catch((err) => { console.warn("fetch fallback:", err?.message); return fallback; });
      const [{ meteo, marine }, windy, windguru, aemetAlerts, aemetRssAlerts, aemetHistoryDb, aemetMaritime] = await Promise.all([
        safe(fetchOpenMeteo(), { meteo: {}, marine: {} }),
        safe(fetchWindyPoint(), { wind: null, gust: null, dir: null }),
        safe(fetchWindguruNearest(), { nearest: null, wind: null, gust: null, dir: null }),
        safe(fetchAemetAlerts(), []),
        safe(fetchAemetAlertsFromRssCap(), []),
        safe(alertHistoryFromDb(30), []),
        safe(fetchAemetMaritimeCastellon(), {}),
      ]);
      // Use cached AVAMET bundle from polling loop (updated every 2 min) — avoids blocking on slow AVAMET fetch
      const avametBundle = LAST_AVAMET_BUNDLE;
      const current = meteo.current || {};
      const marineCurrent = marine.current || {};
      const windSpeed = avametBundle.interpolation?.wind ?? windguru.wind ?? windy.wind ?? toKn(current.wind_speed_10m);
      const windGust = avametBundle.interpolation?.gust ?? windguru.gust ?? windy.gust ?? toKn(current.wind_gusts_10m);
      const windDir = avametBundle.interpolation?.dir ?? windguru.dir ?? windy.dir ?? current.wind_direction_10m ?? 0;
      const hourlyForecast = (meteo.hourly?.time || []).slice(0, 12).map((t, i) => ({
        time: new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
        wind: toKn(meteo.hourly.wind_speed_10m?.[i]) ?? 0,
        gust: toKn(meteo.hourly.wind_gusts_10m?.[i]) ?? 0,
        dir: Number(meteo.hourly.wind_direction_10m?.[i] ?? 0),
      }));
      const hourlyLive = await hourlyFromSamples();
      const hourly = hourlyLive.length >= 6 ? hourlyLive : hourlyForecast;
      const days = (meteo.daily?.time || []).slice(0, 7);
      const forecast = days.map((d, i) => ({
        day: i === 0 ? "Hoy" : new Date(d).toLocaleDateString("es-ES", { weekday: "long" }),
        icon: "partly-cloudy",
        maxWind: toKn(meteo.daily.wind_speed_10m_max?.[i]) ?? 0,
        minWind: Math.max(0, (toKn(meteo.daily.wind_speed_10m_max?.[i]) ?? 0) - 6),
        dir: getDirText(windDir),
        waveH: marine.hourly?.wave_height?.[i * 24] ?? marineCurrent.wave_height ?? 0,
        seaState: "Marejadilla",
      }));
      const station = {
        name: avametBundle.interpolation?.name
          ? avametBundle.interpolation.name
          : (windguru.nearest?.station?.name ? `Estación cercana: ${windguru.nearest.station.name}` : "Estación CVB - referencia local"),
        lastUpdate: new Date().toISOString(),
        current: {
          windSpeed: round1(windSpeed ?? 0),
          windGust: round1(windGust ?? 0),
          windDir: Number(windDir || 0),
          windDirText: getDirText(windDir),
          temp: round1(Number(avametBundle.interpolation?.temp ?? current.temperature_2m ?? 0)),
          humidity: Math.round(Number(avametBundle.interpolation?.humidity ?? current.relative_humidity_2m ?? 0)),
          pressure: Math.round(Number(avametBundle.interpolation?.pressure ?? current.pressure_msl ?? 0)),
          seaTemp: aemetMaritime.seaTemp != null ? round1(Number(aemetMaritime.seaTemp)) : "N/D",
          waveHeight: aemetMaritime.waveHeight != null ? round1(Number(aemetMaritime.waveHeight)) : "N/D",
          visibility: aemetMaritime.visibility || "No disponible",
          cloudCover: Number(current.cloud_cover ?? 0),
        },
        hourly,
        forecast,
      };
      const aemetHistory = aemetHistoryDb;

      // Merge API + RSS, dedupe by fingerprint (both carry the same CAP avisos)
      const alertsByFp = new Map();
      for (const a of [...aemetAlerts, ...aemetRssAlerts]) {
        const fp = alertFingerprint(a);
        if (!alertsByFp.has(fp)) alertsByFp.set(fp, a);
      }
      const mergedAlerts = [...alertsByFp.values()].sort((a, b) => alertRank(b.level) - alertRank(a.level));
      const mergedStations = (avametBundle.around || []).filter((s) => AVAMET_MAP_IDS.includes(s.id));
      const seaTempFallback = Number(marineCurrent.sea_surface_temperature);
      const waveFallback = Number(marineCurrent.wave_height);
      const visibilityFallback = visibilityFromMeters(Number(current.visibility));

      return json(res, 200, {
        ok: true,
        station: {
          ...station,
          current: {
            ...station.current,
            seaTemp: station.current.seaTemp === "N/D" && Number.isFinite(seaTempFallback) ? round1(seaTempFallback) : station.current.seaTemp,
            waveHeight: station.current.waveHeight === "N/D" && Number.isFinite(waveFallback) ? round1(waveFallback) : station.current.waveHeight,
            visibility: (!station.current.visibility || station.current.visibility === "No especificada" || station.current.visibility === "No disponible")
              ? visibilityFallback
              : station.current.visibility,
          },
        },
        stations: mergedStations,
        aemetAlerts: mergedAlerts.length ? mergedAlerts : [{
          id: "no-alert", level: "verde", levelLabel: "Sin Avisos Activos", phenomenon: "General", area: "Litoral Castellón",
          description: "Sin avisos activos o clave AEMET no configurada.", validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), source: "AEMET",
        }],
        aemetHistory: aemetHistory.length ? aemetHistory : (mergedAlerts || []),
        aemetMaritime,
      });
    }

    if (url.pathname === "/api/aemet/dry-run") {
      // Runs the exact dispatcher pipeline (fetch -> merge -> filters -> dedup)
      // and reports what WOULD be sent to the groups, without sending anything.
      const [apiAlerts, rssAlerts] = await Promise.all([
        fetchAemetAlerts().catch(() => []),
        fetchAemetAlertsFromRssCap().catch(() => []),
      ]);
      const byFp = new Map();
      for (const a of [...apiAlerts, ...rssAlerts]) {
        const fp = alertFingerprint(a);
        if (!byFp.has(fp)) byFp.set(fp, a);
      }
      const wouldSend = [];
      const skipped = [];
      for (const [fp, a] of byFp) {
        let reason = null;
        const expiresTs = new Date(a.validTo || 0).getTime();
        if (alertRank(a.level) < 2) reason = "nivel_verde";
        else if (expiresTs && expiresTs < Date.now()) reason = "caducado";
        else if (SENT_ALERT_KEYS.has(fp)) reason = "ya_enviado";
        const item = {
          fingerprint: fp,
          level: a.level,
          area: a.area,
          areaCode: a.areaCode || null,
          phenomenon: a.phenomenon,
          validFrom: a.validFrom,
          validTo: a.validTo,
          source: a.source,
        };
        if (reason) skipped.push({ ...item, reason });
        else wouldSend.push({ ...item, message: formatAlertWhatsappText(a) });
      }
      return json(res, 200, {
        ok: true,
        auto_send_enabled: WA_AUTO_SEND_ENABLED,
        interval_ms: WA_AUTO_SEND_INTERVAL_MS,
        groups: WA_GROUP_IDS,
        api_alerts: apiAlerts.length,
        rss_alerts: rssAlerts.length,
        unique_after_dedup: byFp.size,
        would_send: wouldSend,
        skipped,
        last_dispatch: LAST_AUTO_DISPATCH,
      });
    }

    if (url.pathname === "/api/status") {
      const checks = await Promise.all([
        // AVAMET
        fetchAvametBenicasimStations()
          .then((b) => ({ name: "avamet", ok: !!(b?.around?.length), detail: `${b?.around?.length ?? 0} estaciones` }))
          .catch((e) => ({ name: "avamet", ok: false, detail: e?.message })),
        // AEMET RSS (sin API key)
        fetchAemetAlertsFromRssCap(false)
          .then((a) => ({ name: "aemet_rss", ok: true, detail: `${a.length} alertas en feeds` }))
          .catch((e) => ({ name: "aemet_rss", ok: false, detail: e?.message })),
        // AEMET API key
        AEMET_API_KEY
          ? fetch(`https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/77`, { headers: { api_key: AEMET_API_KEY }, signal: AbortSignal.timeout(8000) })
              .then((r) => ({ name: "aemet_api", ok: r.status !== 401 && r.status !== 403, detail: `HTTP ${r.status}` }))
              .catch((e) => ({ name: "aemet_api", ok: false, detail: e?.message }))
          : Promise.resolve({ name: "aemet_api", ok: false, detail: "AEMET_API_KEY no configurada" }),
        // Meta WhatsApp token
        WHATSAPP_API_TOKEN
          ? fetch(`https://graph.facebook.com/debug_token?input_token=${WHATSAPP_API_TOKEN}&access_token=${WHATSAPP_API_TOKEN}`, { signal: AbortSignal.timeout(8000) })
              .then((r) => r.json())
              .then((d) => {
                if (d?.error) return { name: "meta_wa_token", ok: false, detail: d.error.message };
                const exp = d?.data?.expires_at;
                const expStr = exp ? new Date(exp * 1000).toISOString().slice(0, 10) : "no expira";
                return { name: "meta_wa_token", ok: d?.data?.is_valid ?? false, detail: `válido hasta ${expStr}` };
              })
              .catch((e) => ({ name: "meta_wa_token", ok: false, detail: e?.message }))
          : Promise.resolve({ name: "meta_wa_token", ok: false, detail: "WHATSAPP_API_TOKEN no configurada" }),
        // BunnyDB
        db
          ? db.execute("SELECT 1").then(() => ({ name: "bunnydb", ok: true, detail: "conectado" })).catch((e) => ({ name: "bunnydb", ok: false, detail: e?.message }))
          : Promise.resolve({ name: "bunnydb", ok: false, detail: "LIBSQL_URL no configurada" }),
        // Bunny Storage
        BUNNY_STORAGE_ZONE && BUNNY_STORAGE_PASSWORD
          ? fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/`, { headers: { AccessKey: BUNNY_STORAGE_PASSWORD }, signal: AbortSignal.timeout(8000) })
              .then((r) => ({ name: "bunny_storage", ok: r.ok || r.status === 404, detail: `HTTP ${r.status}` }))
              .catch((e) => ({ name: "bunny_storage", ok: false, detail: e?.message }))
          : Promise.resolve({ name: "bunny_storage", ok: false, detail: "BUNNY_STORAGE_ZONE/PASSWORD no configuradas" }),
        // Sesión WA local
        Promise.resolve({
          name: "wa_session",
          ok: existsSync(join(root, ".wwebjs_auth")),
          detail: existsSync(join(root, ".wwebjs_auth")) ? "sesión local presente" : "sin sesión local (se restaura de Bunny Storage al enviar)",
        }),
        // Open-Meteo (sin auth)
        fetchOpenMeteo()
          .then((d) => ({ name: "open_meteo", ok: !!(d?.meteo?.current), detail: "OK" }))
          .catch((e) => ({ name: "open_meteo", ok: false, detail: e?.message })),
        // Despacho automático de alertas AEMET a grupos WA
        (async () => {
          let lastDbSend = null;
          if (db) {
            try {
              const r = await db.execute("SELECT MAX(sent_at) AS t FROM alert_dispatches");
              const t = Number(r.rows?.[0]?.t || 0);
              if (t) lastDbSend = new Date(t).toISOString();
            } catch { /* table may not exist yet */ }
          }
          const parts = [
            `auto_send=${WA_AUTO_SEND_ENABLED}`,
            `último ciclo: ${LAST_AUTO_DISPATCH.at || "aún no ejecutado"}`,
            `alertas vistas: ${LAST_AUTO_DISPATCH.alerts_seen}`,
            `enviadas en ese ciclo: ${LAST_AUTO_DISPATCH.sent}`,
            `último envío registrado: ${lastDbSend || "ninguno"}`,
          ];
          if (LAST_AUTO_DISPATCH.error) parts.push(`error: ${LAST_AUTO_DISPATCH.error}`);
          return { name: "alert_dispatch", ok: WA_AUTO_SEND_ENABLED && !LAST_AUTO_DISPATCH.error, detail: parts.join(" · ") };
        })(),
      ]);
      const allOk = checks.every((c) => c.ok);
      return json(res, allOk ? 200 : 207, {
        ok: allOk,
        checked_at: new Date().toISOString(),
        services: checks,
      });
    }

    let filePath = normalize(join(distDir, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(distDir)) return json(res, 403, { ok: false });
    if (url.pathname === "/" || !existsSync(filePath)) filePath = join(distDir, "index.html");
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (err) {
    json(res, 500, { ok: false, error: String(err) });
  }
});

// DB must be ready (tables created) before anything writes samples or reads dispatch keys
async function startBackgroundLoops() {
  try {
    await initDb();
    await loadSentAlertKeys();
  } catch (err) {
    console.error("init startup error:", err?.message || err);
  }
  pollInterpolatedSample();
  autoDispatchAemetAlertsToGroups();
  setInterval(pollInterpolatedSample, SAMPLE_INTERVAL_MS);
  setInterval(autoDispatchAemetAlertsToGroups, WA_AUTO_SEND_INTERVAL_MS);
}

// RUNTIME_TEST_MODE=1 allows importing this module (npm test) without side effects
if (process.env.RUNTIME_TEST_MODE !== "1") {
  server.listen(PORT, () => console.log(`runtime server on ${PORT}`));
  startBackgroundLoops();
}

export {
  parseCapXmlToAlerts,
  parseTarFromGzipBuffer,
  isInTargetAemetZone,
  alertFingerprint,
  alertRank,
  formatAlertWhatsappText,
  formatMadridDateTime,
};
