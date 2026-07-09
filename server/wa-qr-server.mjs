import { writeFile, unlink } from "node:fs/promises";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { backupWaSessionToStorage } from "./wa-session-storage.mjs";

// Same duplicate-binding tolerance as wa-send-alert-groups.mjs: wweb.js 1.34.x
// re-injects on framenavigated and puppeteer keeps bindings across navigations.
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
const QR_FILE = process.env.WA_QR_FILE || "/tmp/wa-pending-qr.txt";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});

client.on("qr", async (qr) => {
  await writeFile(QR_FILE, qr, "utf8").catch(() => {});
  console.log("QR listo — abre /api/whatsapp/qr en el navegador para escanearlo");
});

client.on("loading_screen", (percent, msg) => {
  console.log(`WA loading ${percent}% ${msg || ""}`);
});

client.on("authenticated", () => {
  console.log("WA autenticado correctamente");
});

client.on("ready", async () => {
  console.log("WA sesión vinculada — cerrando Chromium antes del backup...");
  try { await unlink(QR_FILE); } catch {}
  // Destroy FIRST: tarring a live Chromium profile produces corrupt archives
  // (files change mid-compression). The session on disk survives destroy().
  try { await client.destroy(); } catch {}
  try {
    const r = await backupWaSessionToStorage(process.cwd());
    console.log(`Sesión guardada en Bunny Storage OK (${r?.bytes || "?"} bytes)`);
    process.exit(0);
  } catch (e) {
    console.error("Error backup sesión:", e?.message || e);
    process.exit(1);
  }
});

client.on("auth_failure", (msg) => {
  console.error("WA auth failure:", msg);
  process.exit(1);
});

client.on("disconnected", (reason) => {
  console.error("WA desconectado:", reason);
  process.exit(2);
});

// Fresh link on purpose: do NOT restore the stored session. If start-qr is
// being called it's because that session is dead, and initializing with a
// logged-out session fires "disconnected: LOGOUT" and kills this process
// before any QR is generated.
try {
  rmSync(`${process.cwd()}/.wwebjs_auth/session-${CLIENT_ID}`, { recursive: true, force: true });
} catch {}
try {
  rmSync(`${process.cwd()}/.wwebjs_cache`, { recursive: true, force: true });
} catch {}

// Watchdog: if nobody scans in 10 min, free the Chromium instead of lingering
const watchdog = setTimeout(() => {
  console.error("QR no escaneado en 10 min — cerrando proceso");
  process.exit(3);
}, 10 * 60 * 1000);
watchdog.unref();

client.initialize();
