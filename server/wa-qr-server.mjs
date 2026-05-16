import pkg from "whatsapp-web.js";
import { writeFile, unlink } from "node:fs/promises";
import { restoreWaSessionFromStorage, backupWaSessionToStorage } from "./wa-session-storage.mjs";

const { Client, LocalAuth } = pkg;

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
  console.log("WA sesión vinculada — haciendo backup a Bunny Storage...");
  try {
    await backupWaSessionToStorage(process.cwd());
    console.log("Sesión guardada en Bunny Storage OK");
  } catch (e) {
    console.error("Error backup sesión:", e?.message || e);
  }
  try { await unlink(QR_FILE); } catch {}
  try { await client.destroy(); } catch {}
  process.exit(0);
});

client.on("auth_failure", (msg) => {
  console.error("WA auth failure:", msg);
  process.exit(1);
});

client.on("disconnected", (reason) => {
  console.error("WA desconectado:", reason);
  process.exit(2);
});

try {
  await restoreWaSessionFromStorage(process.cwd());
} catch (e) {
  console.error("restore warning:", e?.message || e);
}

client.initialize();
