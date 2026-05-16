import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { restoreWaSessionFromStorage, backupWaSessionToStorage } from "./wa-session-storage.mjs";

const { Client, LocalAuth } = pkg;

const GROUP_ID = process.env.WA_GROUP_ID || "";
const MESSAGE = process.env.WA_TEST_MESSAGE || `✅ Test CVB Meteo ${new Date().toISOString()}`;
const CLIENT_ID = process.env.WA_CLIENT_ID || "cvb-group-list-temp";
const HEADLESS = (process.env.WA_HEADLESS || "true") !== "false";

if (!GROUP_ID) {
  console.error("Falta WA_GROUP_ID (ej: 123456789012345678@g.us)");
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});
const rootDir = process.cwd();

console.log(`Arrancando WhatsApp test con clientId=${CLIENT_ID}, headless=${HEADLESS}`);

client.on("qr", (qr) => {
  console.log("Escanea este QR con WhatsApp > Dispositivos vinculados:");
  qrcode.generate(qr, { small: true });
});

client.on("loading_screen", (percent, message) => {
  console.log(`Loading ${percent}% ${message || ""}`);
});

client.on("authenticated", () => {
  console.log("Sesión autenticada.");
});

client.on("ready", async () => {
  try {
    console.log("WhatsApp listo. Enviando mensaje de prueba...");
    const sent = await client.sendMessage(GROUP_ID, MESSAGE);
    console.log(`ID mensaje: ${sent?.id?._serialized || "n/a"}`);
    console.log(`ACK inicial: ${sent?.ack}`);

    let deliveredAck = sent?.ack ?? 0;
    for (let i = 0; i < 10; i++) {
      if (deliveredAck >= 1) break;
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const chat = await client.getChatById(GROUP_ID);
        const recent = await chat.fetchMessages({ limit: 20 });
        const hit = recent.find((m) => m.id?._serialized === sent?.id?._serialized);
        deliveredAck = hit?.ack ?? deliveredAck;
        console.log(`ACK check ${i + 1}: ${deliveredAck}`);
      } catch {
        // keep retrying
      }
    }

    console.log(`Mensaje enviado al grupo ${GROUP_ID} (ack=${deliveredAck})`);
    try {
      await backupWaSessionToStorage(rootDir);
    } catch (e) {
      console.error("backup sesión WA warning:", e?.message || e);
    }
    process.exit(0);
  } catch (err) {
    console.error("Error enviando mensaje:", err?.message || err);
    process.exit(2);
  }
});

client.on("auth_failure", (msg) => {
  console.error("Fallo de autenticación:", msg);
  process.exit(3);
});

client.on("disconnected", (reason) => {
  console.error("Cliente desconectado:", reason);
});

try {
  await restoreWaSessionFromStorage(rootDir);
} catch (e) {
  console.error("restore sesión WA warning:", e?.message || e);
}
client.initialize();
