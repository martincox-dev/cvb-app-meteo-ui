import { existsSync } from "node:fs";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || "";
const STORAGE_PASSWORD = process.env.BUNNY_STORAGE_PASSWORD || "";
const STORAGE_OBJECT = process.env.BUNNY_WA_SESSION_OBJECT || "state/wa-session.tgz";

function hasStorageConfig() {
  return Boolean(STORAGE_ZONE && STORAGE_PASSWORD);
}

function run(cmd, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `${cmd} exit ${code}`));
    });
  });
}

export async function restoreWaSessionFromStorage(rootDir) {
  if (!hasStorageConfig()) return { ok: false, skipped: true, reason: "missing_storage_config" };
  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${STORAGE_OBJECT}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { AccessKey: STORAGE_PASSWORD },
  });
  if (res.status === 404) return { ok: false, skipped: true, reason: "no_remote_snapshot" };
  if (!res.ok) throw new Error(`restore GET failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  await mkdir(`${rootDir}/.tmp`, { recursive: true });
  const tarPath = `${rootDir}/.tmp/wa-session.tgz`;
  await writeFile(tarPath, data);

  await rm(`${rootDir}/.wwebjs_auth`, { recursive: true, force: true });
  await rm(`${rootDir}/.wwebjs_cache`, { recursive: true, force: true });
  await run("tar", ["-xzf", tarPath, "-C", rootDir], rootDir);
  return { ok: true, restored: true };
}

export async function backupWaSessionToStorage(rootDir) {
  if (!hasStorageConfig()) return { ok: false, skipped: true, reason: "missing_storage_config" };
  const hasAuth = existsSync(`${rootDir}/.wwebjs_auth`);
  const hasCache = existsSync(`${rootDir}/.wwebjs_cache`);
  if (!hasAuth && !hasCache) return { ok: false, skipped: true, reason: "no_local_session" };

  await mkdir(`${rootDir}/.tmp`, { recursive: true });
  const tarPath = `${rootDir}/.tmp/wa-session.tgz`;
  const paths = [];
  if (hasAuth) paths.push(".wwebjs_auth");
  if (hasCache) paths.push(".wwebjs_cache");
  await run("tar", ["-czf", tarPath, ...paths], rootDir);
  const body = await readFile(tarPath);

  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${STORAGE_OBJECT}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { AccessKey: STORAGE_PASSWORD, "Content-Type": "application/gzip" },
    body,
  });
  if (!res.ok) throw new Error(`backup PUT failed: HTTP ${res.status}`);
  return { ok: true, backedUp: true };
}
