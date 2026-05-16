import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { restoreWaSessionFromStorage, backupWaSessionToStorage } from "./wa-session-storage.mjs";

const { Client, LocalAuth } = pkg;

const SEARCH = (process.env.WA_GROUP_SEARCH || "CVB").toLowerCase();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "cvb-group-list-temp" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});
const rootDir = process.cwd();

console.log(`Buscando grupos que contengan: "${SEARCH}"`);

client.on("qr", (qr) => {
  console.log("Escanea QR:");
  qrcode.generate(qr, { small: true });
});

client.on("loading_screen", (percent, msg) => {
  console.log(`Cargando WhatsApp: ${percent}% ${msg || ""}`);
});

client.on("authenticated", () => {
  console.log("Sesión autenticada.");
});

client.on("auth_failure", (msg) => {
  console.error("Fallo auth:", msg);
  process.exit(2);
});

client.on("ready", async () => {
  try {
    console.log("Cliente listo, leyendo chats...");
    const chats = await client.getChats();
    const hits = chats.filter((c) => (c.name || "").toLowerCase().includes(SEARCH));
    if (!hits.length) {
      console.log("No hay coincidencias.");
    } else {
      for (const c of hits) {
        console.log(`${c.isGroup ? "GROUP" : "CHAT"} | ${c.name} -> ${c.id?._serialized}`);
      }
    }
    try {
      await backupWaSessionToStorage(rootDir);
    } catch (e) {
      console.error("backup sesión WA warning:", e?.message || e);
    }
    await client.destroy();
    process.exit(0);
  } catch (err) {
    console.error("Error leyendo chats:", err?.message || err);
    process.exit(3);
  }
});

try {
  await restoreWaSessionFromStorage(rootDir);
} catch (e) {
  console.error("restore sesión WA warning:", e?.message || e);
}
client.initialize();
