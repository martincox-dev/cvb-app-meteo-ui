import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

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
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";
const WHATSAPP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "en_US";
const WHATSAPP_TEST_TO = process.env.WHATSAPP_TEST_TO || "";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");

const toKn = (ms) => (typeof ms === "number" ? +(ms * 1.943844).toFixed(1) : null);
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
  try {
    const data = await fetchJson(`${WINDGURU_STATIONS_URL}?id_station=all&format=json`);
    const stations = Array.isArray(data) ? data : Array.isArray(data?.stations) ? data.stations : [];
    let nearest = null;
    for (const s of stations) {
      const lat = Number(s?.lat);
      const lon = Number(s?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const d = haversineKm(LAT, LON, lat, lon);
      if (!nearest || d < nearest.distanceKm) nearest = { station: s, distanceKm: d };
    }
    if (!nearest) return { nearest: null, wind: null, gust: null, dir: null };
    const wind = Number(nearest.station.wind_avg ?? nearest.station.wind);
    const gust = Number(nearest.station.wind_max ?? nearest.station.gust);
    const dir = Number(nearest.station.wind_dir ?? nearest.station.dir);
    return { nearest, wind: Number.isFinite(wind) ? +wind.toFixed(1) : null, gust: Number.isFinite(gust) ? +gust.toFixed(1) : null, dir: Number.isFinite(dir) ? dir : null };
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
  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&daily=wind_speed_10m_max,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min&timezone=Europe/Madrid&forecast_days=7`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&current=wave_height,sea_surface_temperature&hourly=wave_height,wave_period`;
  const [meteo, marine] = await Promise.all([fetchJson(meteoUrl), fetchJson(marineUrl)]);
  return { meteo, marine };
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
      const [alerts] = await Promise.all([fetchAemetAlerts()]);
      if (!alerts.length) {
        return json(res, 404, {
          ok: false,
          error: "no_aemet_alerts_for_target_zones",
          target_keywords: AEMET_TARGET_KEYWORDS,
          target_codes: AEMET_TARGET_ZONE_CODES,
        });
      }
      const best = [...alerts].sort((a, b) => alertRank(b.level) - alertRank(a.level))[0];
      const bodyParams = [
        { type: "text", text: String(best.area || "-").slice(0, 1024) },
        { type: "text", text: String(best.levelLabel || best.level || "-").slice(0, 1024) },
        { type: "text", text: String(best.phenomenon || "-").slice(0, 1024) },
        { type: "text", text: String(best.description || "-").slice(0, 1024) },
        { type: "text", text: String(best.validFrom || "-").slice(0, 1024) },
        { type: "text", text: String(best.validTo || "-").slice(0, 1024) },
      ];
      const send = await sendWhatsAppTemplate({
        to: WHATSAPP_TEST_TO || "34677025272",
        templateName: WHATSAPP_TEMPLATE_NAME,
        langCode: WHATSAPP_TEMPLATE_LANG,
        components: [{ type: "body", parameters: bodyParams }],
      });
      return json(res, 200, {
        ok: true,
        sent_alert: {
          area: best.area,
          level: best.level,
          phenomenon: best.phenomenon,
          validFrom: best.validFrom,
          validTo: best.validTo,
        },
        message_id: send?.messages?.[0]?.id || null,
        status: send?.messages?.[0]?.message_status || "accepted",
      });
    }

    if (url.pathname === "/api/meteo") {
      const [{ meteo, marine }, windy, windguru, aemetAlerts, aemetArchiveRaw, stations] = await Promise.all([
        fetchOpenMeteo(),
        fetchWindyPoint(),
        fetchWindguruNearest(),
        fetchAemetAlerts(),
        fetchAemetAlertsArchive(5),
        fetchCastellonStations(),
      ]);
      const current = meteo.current || {};
      const marineCurrent = marine.current || {};
      const windSpeed = windguru.wind ?? windy.wind ?? toKn(current.wind_speed_10m);
      const windGust = windguru.gust ?? windy.gust ?? toKn(current.wind_gusts_10m);
      const windDir = windguru.dir ?? windy.dir ?? current.wind_direction_10m ?? 0;
      const hourly = (meteo.hourly?.time || []).slice(0, 12).map((t, i) => ({
        time: new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
        wind: toKn(meteo.hourly.wind_speed_10m?.[i]) ?? 0,
        gust: toKn(meteo.hourly.wind_gusts_10m?.[i]) ?? 0,
        dir: Number(meteo.hourly.wind_direction_10m?.[i] ?? 0),
      }));
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
        name: windguru.nearest?.station?.name ? `Estación cercana: ${windguru.nearest.station.name}` : "Estación CVB - referencia local",
        lastUpdate: new Date().toISOString(),
        current: {
          windSpeed: windSpeed ?? 0,
          windGust: windGust ?? 0,
          windDir: Number(windDir || 0),
          windDirText: getDirText(windDir),
          temp: Number(current.temperature_2m ?? 0).toFixed(1),
          humidity: Number(current.relative_humidity_2m ?? 0),
          pressure: Number(current.pressure_msl ?? 0).toFixed(1),
          seaTemp: Number(marineCurrent.sea_surface_temperature ?? 0).toFixed(1),
          waveHeight: Number(marineCurrent.wave_height ?? 0).toFixed(1),
          visibility: "Buena",
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

      return json(res, 200, {
        ok: true,
        station,
        stations,
        aemetAlerts: aemetAlerts.length ? aemetAlerts : [{
          id: "no-alert", level: "verde", levelLabel: "Sin Avisos Activos", phenomenon: "General", area: "Litoral Castellón",
          description: "Sin avisos activos o clave AEMET no configurada.", validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), source: "AEMET",
        }],
        aemetHistory: aemetHistory.length ? aemetHistory : (aemetAlerts || []),
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
