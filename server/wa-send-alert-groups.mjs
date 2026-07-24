import fs from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { restoreWaSessionFromStorage, backupWaSessionToStorage } from "./wa-session-storage.mjs";

// whatsapp-web.js 1.34.x re-injects its page bindings on every framenavigated,
// but puppeteer keeps bindings across navigations, so the second exposeFunction
// throws "Failed to add page binding ... already exists" and kills the process.
// Patch the helper (before requiring the lib, so Client.js destructures the
// patched reference) to tolerate that specific error.
const require = createRequire(import.meta.url);
const pupUtil = require("whatsapp-web.js/src/util/Puppeteer.js");
const origExpose = pupUtil.exposeFunctionIfAbsent;
pupUtil.exposeFunctionIfAbsent = async (page, name, fn) => {
  try {
    await origExpose(page, name, fn);
  } catch (err) {
    if (!String(err?.message || "").includes("already exists")) throw err;
  }
};
const { Client, LocalAuth } = require("whatsapp-web.js");

const CLIENT_ID = process.env.WA_CLIENT_ID || "cvb-group-list-temp";
const HEADLESS = (process.env.WA_HEADLESS || "true") !== "false";
const GROUP_IDS_ENV = (process.env.WA_GROUP_IDS || "").trim();
const MESSAGE = (process.env.WA_ALERT_MESSAGE || "").trim();

function parseLocalGroupsFile() {
  const path = "whatsapp-groups.local";
  if (!fs.existsSync(path)) return [];
  const txt = readFileSync(path, "utf8");
  const lines = txt.split(/\r?\n/);
  const wanted = ["GROUP_JUNTA_CVB", "GROUP_CVB"];
  const out = [];
  for (const key of wanted) {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    if (!line) continue;
    const val = line.split("=").slice(1).join("=").trim();
    if (val) out.push(val);
  }
  return out;
}

const GROUP_IDS = GROUP_IDS_ENV
  ? GROUP_IDS_ENV.split(",").map((s) => s.trim()).filter(Boolean)
  : parseLocalGroupsFile();

if (!GROUP_IDS.length) {
  console.error("Faltan grupos. Usa WA_GROUP_IDS o whatsapp-groups.local con GROUP_JUNTA_CVB/GROUP_CVB");
  process.exit(1);
}

if (!MESSAGE) {
  console.error("Falta WA_ALERT_MESSAGE");
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // WA Web's first sync keeps the page busy for minutes; puppeteer's default
    // 180s protocolTimeout kills the send mid-sync. The watchdog bounds us.
    protocolTimeout: 600000,
  },
});

console.log(`Arrancando envío a ${GROUP_IDS.length} grupos (clientId=${CLIENT_ID}, headless=${HEADLESS})`);
const rootDir = process.cwd();

// Watchdog global: este proceso NUNCA debe colgarse — el dispatcher del runtime
// espera su salida y un cuelgue bloquea todos los ciclos de alertas siguientes.
const WATCHDOG_MS = Number(process.env.WA_SEND_TIMEOUT_MS || 420000);
const watchdog = setTimeout(async () => {
  console.error(`Timeout global de envío tras ${WATCHDOG_MS} ms — abortando`);
  // Close Chromium before exiting or it can outlive us holding the profile
  try { await Promise.race([client.destroy(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
  process.exit(4);
}, WATCHDOG_MS);
watchdog.unref();

client.on("loading_screen", (percent, msg) => {
  console.log(`WA loading ${percent}% ${msg || ""}`);
});

client.on("authenticated", () => {
  console.log("WA autenticado");
});

client.on("qr", async () => {
  console.error("Se requiere QR: la sesión no es válida. Re-vincular con POST /api/whatsapp/start-qr");
  try { await client.destroy(); } catch {}
  process.exit(5);
});

client.on("auth_failure", async (msg) => {
  console.error("auth_failure:", msg);
  try { await client.destroy(); } catch {}
  process.exit(6);
});

client.on("ready", async () => {
  const results = [];
  try {
    for (const groupId of GROUP_IDS) {
      // NINGÚN valor devuelto por la librería es fiable como criterio de éxito:
      // - ack no confirmado con el móvil sin cobertura (incidente 2026-07-15)
      // - sendMessage devuelve Message vacío con id=undefined aunque el
      //   mensaje SÍ sale (incidente 2026-07-18, wweb.js 1.34 vs WA Web actual)
      // Éxito = verificar en el propio chat que nuestro mensaje está ahí.
      let sent = null;
      let sendError = null;
      try {
        sent = await client.sendMessage(groupId, MESSAGE);
      } catch (e) {
        sendError = e;
      }
      let messageId = sent?.id?._serialized || null;
      let ack = sent?.ack ?? 0;
      let verified = Boolean(messageId);
      // Igualdad sobre texto normalizado: inmune a \r\n y espacios fantasma que
      // WhatsApp pueda introducir, pero SIN relajar a prefijos/fragmentos — un
      // aviso anterior en el historial nunca debe verificar un envío nuevo.
      const normText = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const targetText = normText(MESSAGE);
      for (let i = 0; i < 6 && !verified; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const chat = await client.getChatById(groupId);
          const recent = await chat.fetchMessages({ limit: 10 });
          const hit = recent.find((m) => m.fromMe && normText(m.body) === targetText);
          if (hit) {
            verified = true;
            messageId = hit.id?._serialized || messageId;
            ack = hit.ack ?? ack;
          }
        } catch {
          // seguimos intentando verificar
        }
      }
      if (sendError && !verified) console.error(`sendMessage lanzó error en ${groupId}:`, sendError?.message || sendError);
      if (!verified) {
        // Diagnóstico: qué hay realmente en el chat para comparar con lo esperado
        try {
          const chat = await client.getChatById(groupId);
          const recent = await chat.fetchMessages({ limit: 6 });
          const mine = recent.filter((m) => m.fromMe).map((m) => normText(m.body).slice(0, 90));
          console.error(`no verificado en ${groupId} · esperado[0..90]=${JSON.stringify(targetText.slice(0, 90))} · fromMe recientes=${JSON.stringify(mine)}`);
        } catch (e) {
          console.error(`no verificado en ${groupId} y el dump de chat falló:`, e?.message || e);
        }
      }
      const status = verified ? "confirmed" : (sendError ? "failed" : "unconfirmed");
      results.push({
        groupId,
        messageId,
        ack,
        verified,
        status,
        error: sendError ? String(sendError?.message || sendError) : null,
      });
      console.log(`Enviado ${groupId} estado=${status} verificado=${verified} ack=${ack} id=${messageId}`);
    }
    await client.destroy();
    console.log(`WA_SEND_RESULT ${JSON.stringify({ results })}`);
    const failed = results.filter((r) => r.status === "failed");
    if (failed.length) {
      console.error("envío fallido en:", failed.map((f) => f.groupId).join(","));
      process.exit(2);
    }
    try {
      await backupWaSessionToStorage(rootDir);
    } catch (e) {
      console.error("backup sesión WA warning:", e?.message || e);
    }
    process.exit(0);
  } catch (err) {
    console.error("Error envío grupos:", err?.message || err);
    try { await client.destroy(); } catch {}
    process.exit(3);
  }
});

// Keep an existing local session: it may hold sync progress from previous
// attempts (or a fresher state than the remote snapshot). Only restore from
// storage when there is no local session at all (fresh container).
if (fs.existsSync(`${rootDir}/.wwebjs_auth/session-${CLIENT_ID}`)) {
  console.log("usando sesión local existente (sin restore)");
} else {
  try {
    const restored = await restoreWaSessionFromStorage(rootDir);
    console.log("restore WA session:", JSON.stringify(restored));
  } catch (e) {
    console.error("restore sesión WA warning:", e?.message || e);
  }
}

// Remove stale SingletonLock left by a previous Chromium process
try {
  fs.rmSync(`${rootDir}/.wwebjs_auth/session-${CLIENT_ID}/SingletonLock`);
} catch {}

// Mark the profile as cleanly exited. A profile restored with exit_type=Crashed
// makes Chromium re-open the old WhatsApp Web tabs, and whatsapp-web.js then
// fails to inject ("page binding onQRChangedEvent already exists").
try {
  const prefsPath = `${rootDir}/.wwebjs_auth/session-${CLIENT_ID}/Default/Preferences`;
  const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
  if (prefs.profile) {
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  }
} catch {}

client.initialize();
