import pkg from "whatsapp-web.js";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { restoreWaSessionFromStorage, backupWaSessionToStorage } from "./wa-session-storage.mjs";

const { Client, LocalAuth } = pkg;

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
  },
});

console.log(`Arrancando envío a ${GROUP_IDS.length} grupos (clientId=${CLIENT_ID}, headless=${HEADLESS})`);
const rootDir = process.cwd();

client.on("qr", () => {
  console.error("Se requiere QR en esta sesión. Vincula primero con list-cvb-group/wa:test.");
});

client.on("ready", async () => {
  const results = [];
  try {
    for (const groupId of GROUP_IDS) {
      const sent = await client.sendMessage(groupId, MESSAGE);
      let ack = sent?.ack ?? 0;
      for (let i = 0; i < 10; i++) {
        if (ack >= 1) break;
        await new Promise((r) => setTimeout(r, 1200));
        try {
          const chat = await client.getChatById(groupId);
          const recent = await chat.fetchMessages({ limit: 20 });
          const hit = recent.find((m) => m.id?._serialized === sent?.id?._serialized);
          ack = hit?.ack ?? ack;
        } catch {
          // retry loop continues
        }
      }
      results.push({ groupId, messageId: sent?.id?._serialized, ack });
      console.log(`Enviado ${groupId} ack=${ack} id=${sent?.id?._serialized}`);
    }
    await client.destroy();
    const failed = results.filter((r) => r.ack < 1);
    if (failed.length) {
      console.error("Algunos envíos no alcanzaron ack>=1", failed);
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
    process.exit(3);
  }
});

try {
  const restored = await restoreWaSessionFromStorage(rootDir);
  console.log("restore WA session:", JSON.stringify(restored));
} catch (e) {
  console.error("restore sesión WA warning:", e?.message || e);
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
