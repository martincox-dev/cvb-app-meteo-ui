import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PORT = Number(process.env.PORT || 3001);
const LAT = Number(process.env.LATITUDE || "40.04375215857617");
const LON = Number(process.env.LONGITUDE || "0.0651749140667065");
const AEMET_API_KEY = process.env.AEMET_API_KEY || "";
const AEMET_TARGET_ZONE_CODES = (process.env.AEMET_TARGET_ZONE_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const AEMET_TARGET_KEYWORDS = (
  process.env.AEMET_TARGET_KEYWORDS ||
  "Litoral Sur Castellón,Litoral Sur Castellón - Costa"
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

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");
const SAMPLE_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 2 * 60 * 1000;
let LAST_AVAMET_BUNDLE = { around: [], primary: [], interpolation: null };
let INTERPOLATED_SAMPLES = [];

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

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchJsonRetry(url, options = {}, retries = 2) {
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
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function parseTarFromGzipBuffer(gzipBuffer) {
  const buf = gunzipSync(gzipBuffer);
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
  const infoBlocks = [...xml.matchAll(/<info[\s\S]*?<\/info>/gi)].map((m) => m[0]);
  const alerts = [];
  for (const block of infoBlocks) {
    const event = getTag(block, "event");
    const severity = getTag(block, "severity");
    const description = getTag(block, "description");
    const effective = getTag(block, "effective");
    const expires = getTag(block, "expires");
    const areaDesc = getTag(block, "areaDesc");
    const headline = getTag(block, "headline");
    const certainty = getTag(block, "certainty");
    if (!event && !description && !areaDesc) continue;
    alerts.push({
      id: `cap-${Math.random().toString(36).slice(2, 10)}`,
      level: String(severity || "").toLowerCase().includes("extreme")
        ? "rojo"
        : String(severity || "").toLowerCase().includes("severe")
          ? "naranja"
          : String(severity || "").toLowerCase().includes("moderate")
            ? "amarillo"
            : "verde",
      levelLabel: severity || "Aviso",
      phenomenon: event || "Aviso meteorológico",
      area: areaDesc || "Castellón",
      description: htmlDecode(description || headline || ""),
      validFrom: effective || new Date().toISOString(),
      validTo: expires || new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      source: "AEMET RSS/CAP",
      certainty: certainty || "",
    });
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
      const resp = await fetch(tarLink);
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
  if (!AEMET_API_KEY) return [];
  try {
    const idx = await fetchJson("https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/va3", { headers: { api_key: AEMET_API_KEY } });
    if (!idx?.datos) return [];
    const raw = await fetchJson(idx.datos);
    const list = Array.isArray(raw) ? raw : [raw];
    const mapped = list.map((a, i) => {
      const sev = String(a?.nivel || a?.severity || "").toLowerCase();
      let level = "verde";
      if (sev.includes("amar")) level = "amarillo";
      if (sev.includes("naran")) level = "naranja";
      if (sev.includes("rojo")) level = "rojo";
      const areaText = String(a?.ambito || a?.area || a?.geocode || "Litoral Castellón");
      const areaCode = String(a?.idZona || a?.code || a?.geocode || a?.id || "");
      const desc = String(
        a?.descripcion ||
        a?.description ||
        a?.instruction ||
        a?.headline ||
        a?.event ||
        "Aviso oficial de AEMET"
      );
      return {
        id: String(a?.id || `aemet-${i}`),
        areaCode,
        level,
        levelLabel: level === "amarillo" ? "Aviso Amarillo" : level === "naranja" ? "Aviso Naranja" : level === "rojo" ? "Aviso Rojo" : "Sin Aviso",
        phenomenon: a?.fenomeno || a?.phenomenon || "Aviso meteorológico",
        area: areaText,
        description: desc,
        validFrom: a?.inicio || a?.effective || new Date().toISOString(),
        validTo: a?.fin || a?.expires || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        raw: a,
        source: "AEMET",
      };
    });
    const filtered = mapped.filter((alert) => {
      const haystack = `${alert.area} ${alert.description}`.toLowerCase();
      const byKeyword = AEMET_TARGET_KEYWORDS.some((k) => haystack.includes(k));
      const byCode = AEMET_TARGET_ZONE_CODES.length
        ? AEMET_TARGET_ZONE_CODES.some((c) => String(alert.areaCode).includes(c))
        : false;
      return byKeyword || byCode;
    });
    return filtered;
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

function toAemetUtc(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}UTC`
  );
}

async function fetchAemetAlertsArchive(days = 3) {
  if (!AEMET_API_KEY) return [];
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const url =
      `https://opendata.aemet.es/opendata/api/avisos_cap/archivo/fechaini/${toAemetUtc(start)}/fechafin/${toAemetUtc(end)}`;
    const idx = await fetchJson(url, { headers: { api_key: AEMET_API_KEY } });
    if (!idx?.datos) return [];
    const raw = await fetchJson(idx.datos);
    const list = Array.isArray(raw) ? raw : [raw];
    return list;
  } catch {
    return [];
  }
}

function mapAemetAlertRaw(a, i = 0) {
  const sev = String(a?.nivel || a?.severity || "").toLowerCase();
  let level = "verde";
  if (sev.includes("amar")) level = "amarillo";
  if (sev.includes("naran")) level = "naranja";
  if (sev.includes("rojo")) level = "rojo";
  const areaText = String(a?.ambito || a?.area || a?.geocode || "Litoral Castellón");
  const areaCode = String(a?.idZona || a?.code || a?.geocode || a?.id || "");
  const desc = String(
    a?.descripcion ||
    a?.description ||
    a?.instruction ||
    a?.headline ||
    a?.event ||
    "Aviso oficial de AEMET"
  );
  return {
    id: String(a?.id || `aemet-${i}`),
    areaCode,
    level,
    levelLabel: level === "amarillo" ? "Aviso Amarillo" : level === "naranja" ? "Aviso Naranja" : level === "rojo" ? "Aviso Rojo" : "Sin Aviso",
    phenomenon: a?.fenomeno || a?.phenomenon || "Aviso meteorológico",
    area: areaText,
    description: desc,
    validFrom: a?.inicio || a?.effective || new Date().toISOString(),
    validTo: a?.fin || a?.expires || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    raw: a,
    source: "AEMET",
  };
}

function isInTargetAemetZone(alert) {
  const haystack = `${alert.area} ${alert.description}`.toLowerCase();
  const byKeyword = AEMET_TARGET_KEYWORDS.some((k) => haystack.includes(k));
  const byCode = AEMET_TARGET_ZONE_CODES.length
    ? AEMET_TARGET_ZONE_CODES.some((c) => String(alert.areaCode).includes(c))
    : false;
  return byKeyword || byCode;
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
    const data = await fetchJsonRetry("https://www.avamet.org/mxo-i-2023.json", {}, 2);
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
  } catch {
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
  } catch {
    // ignore polling errors
  }
}

function hourlyFromSamples() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = INTERPOLATED_SAMPLES.filter((s) => s.ts >= start);
  if (!today.length) return [];
  const byHour = new Map();
  for (const s of today) {
    const h = new Date(s.ts).getHours();
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(s);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-12)
    .map(([h, list]) => ({
      time: `${String(h).padStart(2, "0")}:00`,
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
      const alerts = apiAlerts.length ? apiAlerts : rssAlerts;
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
          { type: "text", text: String(alert.validFrom || "-").slice(0, 1024) },
          { type: "text", text: String(alert.validTo || "-").slice(0, 1024) },
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
      const [archiveRaw, rssAll] = await Promise.all([fetchAemetAlertsArchive(5), fetchAemetAlertsFromRssCap(false)]);
      const archiveAlerts = archiveRaw.map((a, i) => mapAemetAlertRaw(a, i));
      const candidates = [...archiveAlerts, ...rssAll];
      if (!candidates.length) {
        return json(res, 404, { ok: false, error: "no_aemet_alerts_available" });
      }
      const selected = [...candidates].sort((a, b) => alertRank(b.level) - alertRank(a.level))[0];
      const bodyParams = [
        { type: "text", text: String(selected.area || "-").slice(0, 1024) },
        { type: "text", text: String(selected.levelLabel || selected.level || "-").slice(0, 1024) },
        { type: "text", text: String(selected.phenomenon || "-").slice(0, 1024) },
        { type: "text", text: String(selected.description || "-").slice(0, 1024) },
        { type: "text", text: String(selected.validFrom || "-").slice(0, 1024) },
        { type: "text", text: String(selected.validTo || "-").slice(0, 1024) },
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

    if (url.pathname === "/api/meteo") {
      const [{ meteo, marine }, windy, windguru, aemetAlerts, aemetRssAlerts, aemetArchiveRaw, avametBundle, aemetMaritime] = await Promise.all([
        fetchOpenMeteo(),
        fetchWindyPoint(),
        fetchWindguruNearest(),
        fetchAemetAlerts(),
        fetchAemetAlertsFromRssCap(),
        fetchAemetAlertsArchive(5),
        fetchAvametBenicasimStations(),
        fetchAemetMaritimeCastellon(),
      ]);
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
      const hourlyLive = hourlyFromSamples();
      const hourly = hourlyLive.length ? hourlyLive : hourlyForecast;
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
      const aemetHistory = aemetArchiveRaw
        .map((a, i) => mapAemetAlertRaw(a, i))
        .filter((a) => isInTargetAemetZone(a))
        .sort((a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime())
        .slice(0, 30);

      const mergedAlerts = aemetAlerts.length ? aemetAlerts : aemetRssAlerts;
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

server.listen(PORT, () => console.log(`runtime server on ${PORT}`));
pollInterpolatedSample();
setInterval(pollInterpolatedSample, SAMPLE_INTERVAL_MS);
