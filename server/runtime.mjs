import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3001);
const LAT = Number(process.env.LATITUDE || "40.04375215857617");
const LON = Number(process.env.LONGITUDE || "0.0651749140667065");
const AEMET_API_KEY = process.env.AEMET_API_KEY || "";
const WINDY_API_KEY = process.env.WINDY_API_KEY || "";
const WINDGURU_STATIONS_URL = process.env.WINDGURU_STATIONS_URL || "https://stations.windguru.cz/data_api.php";

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

async function fetchAemetAlerts() {
  if (!AEMET_API_KEY) return [];
  try {
    const idx = await fetchJson("https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/va3", { headers: { api_key: AEMET_API_KEY } });
    if (!idx?.datos) return [];
    const raw = await fetchJson(idx.datos);
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((a, i) => {
      const sev = String(a?.nivel || a?.severity || "").toLowerCase();
      let level = "verde";
      if (sev.includes("amar")) level = "amarillo";
      if (sev.includes("naran")) level = "naranja";
      if (sev.includes("rojo")) level = "rojo";
      return {
        id: String(a?.id || `aemet-${i}`),
        level,
        levelLabel: level === "amarillo" ? "Aviso Amarillo" : level === "naranja" ? "Aviso Naranja" : level === "rojo" ? "Aviso Rojo" : "Sin Aviso",
        phenomenon: a?.fenomeno || a?.phenomenon || "Aviso meteorológico",
        area: a?.ambito || a?.area || "Litoral Castellón",
        description: a?.descripcion || a?.description || "Aviso oficial de AEMET",
        validFrom: a?.inicio || a?.effective || new Date().toISOString(),
        validTo: a?.fin || a?.expires || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        source: "AEMET",
      };
    });
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

const server = createServer(async (req, res) => {
  try {
    if (!req.url) return json(res, 400, { ok: false, error: "bad request" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true });

    if (url.pathname === "/api/meteo") {
      const [{ meteo, marine }, windy, windguru, aemetAlerts] = await Promise.all([fetchOpenMeteo(), fetchWindyPoint(), fetchWindguruNearest(), fetchAemetAlerts()]);
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
      return json(res, 200, {
        ok: true,
        station,
        aemetAlerts: aemetAlerts.length ? aemetAlerts : [{
          id: "no-alert", level: "verde", levelLabel: "Sin Avisos Activos", phenomenon: "General", area: "Litoral Castellón",
          description: "Sin avisos activos o clave AEMET no configurada.", validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), source: "AEMET",
        }],
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
