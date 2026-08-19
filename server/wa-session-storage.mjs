import { existsSync } from "node:fs";
import { mkdir, rm, readdir, readFile, writeFile, stat } from "node:fs/promises";
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

// Per-process temp path: QR server and send script can run at the same time
// and must not clobber each other's tarball. Staged on the ephemeral project
// dir, never on the persistent volume (no need for it to survive a restart).
function tempTarPath(scratchDir) {
  return `${scratchDir}/.tmp/wa-session-${process.pid}.tgz`;
}

async function verifyTgz(tarPath, scratchDir) {
  // Full archive listing fails on any truncated gzip stream or tar entry
  await run("tar", ["-tzf", tarPath], scratchDir);
}

// Empties dataDir's contents without removing dataDir itself — if dataDir is
// a volume mount point, rm-ing the directory entry itself is best avoided.
async function clearDirContents(dataDir) {
  const entries = await readdir(dataDir).catch(() => []);
  await Promise.all(entries.map((e) => rm(`${dataDir}/${e}`, { recursive: true, force: true })));
}

/**
 * @param {string} dataDir - directory whose contents ARE the WA session
 *   (e.g. the persistent volume mount, or a local ./.wwebjs_auth fallback)
 * @param {string} scratchDir - ephemeral dir to stage the temp tarball in
 */
export async function restoreWaSessionFromStorage(dataDir, scratchDir = process.cwd()) {
  if (!hasStorageConfig()) return { ok: false, skipped: true, reason: "missing_storage_config" };
  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${STORAGE_OBJECT}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { AccessKey: STORAGE_PASSWORD },
  });
  if (res.status === 404) return { ok: false, skipped: true, reason: "no_remote_snapshot" };
  if (!res.ok) throw new Error(`restore GET failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  await mkdir(`${scratchDir}/.tmp`, { recursive: true });
  const tarPath = tempTarPath(scratchDir);
  await writeFile(tarPath, data);

  // Verify BEFORE wiping the local session: a truncated download must never
  // leave us with neither remote nor local session.
  try {
    await verifyTgz(tarPath, scratchDir);
  } catch (e) {
    await rm(tarPath, { force: true });
    throw new Error(`snapshot corrupto, se conserva la sesión local: ${e?.message || e}`);
  }

  await mkdir(dataDir, { recursive: true });
  await clearDirContents(dataDir);
  await run("tar", ["-xzf", tarPath, "-C", dataDir], scratchDir);
  await rm(tarPath, { force: true });

  // Old-format snapshots (pre-volume era) nest the profile under literal
  // ".wwebjs_auth"/".wwebjs_cache" instead of sitting flat in dataDir. If we
  // just extracted one of those, promote its content up so LocalAuth (which
  // only reads "session-<clientId>" directly under dataDir) actually finds it.
  for (const legacyName of [".wwebjs_auth", ".wwebjs_cache"]) {
    const legacyPath = `${dataDir}/${legacyName}`;
    if (!existsSync(legacyPath)) continue;
    const children = await readdir(legacyPath).catch(() => []);
    for (const child of children) {
      await rm(`${dataDir}/${child}`, { recursive: true, force: true }).catch(() => {});
      await run("mv", [`${legacyPath}/${child}`, `${dataDir}/${child}`], scratchDir).catch(() => {});
    }
    await rm(legacyPath, { recursive: true, force: true }).catch(() => {});
  }

  return { ok: true, restored: true };
}

export async function backupWaSessionToStorage(dataDir, scratchDir = process.cwd()) {
  if (!hasStorageConfig()) return { ok: false, skipped: true, reason: "missing_storage_config" };
  // One-time cleanup: old-format remote snapshots (pre-volume era) stored
  // the profile nested under literal ".wwebjs_auth"/".wwebjs_cache" names.
  // A restore of one of those into the new flat dataDir leaves that nesting
  // behind as dead weight (LocalAuth only ever reads "session-<clientId>"
  // directly under dataDir) — strip it here so it never bloats a backup.
  await rm(`${dataDir}/.wwebjs_auth`, { recursive: true, force: true }).catch(() => {});
  await rm(`${dataDir}/.wwebjs_cache`, { recursive: true, force: true }).catch(() => {});

  const entries = await readdir(dataDir).catch(() => []);
  if (!entries.length) return { ok: false, skipped: true, reason: "no_local_session" };

  await mkdir(`${scratchDir}/.tmp`, { recursive: true });
  const tarPath = tempTarPath(scratchDir);
  await run("tar", ["-czf", tarPath, "-C", dataDir, "."], scratchDir);
  // Never upload a broken archive (e.g. profile files changing mid-tar)
  await verifyTgz(tarPath, scratchDir);
  const body = await readFile(tarPath);
  const localSize = (await stat(tarPath)).size;

  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${STORAGE_OBJECT}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { AccessKey: STORAGE_PASSWORD, "Content-Type": "application/gzip" },
    body,
  });
  if (!res.ok) throw new Error(`backup PUT failed: HTTP ${res.status}`);

  // Confirm the stored object has the exact size we sent. Bunny Storage
  // rejects HEAD (401), so use a 1-byte ranged GET and read Content-Range.
  const probe = await fetch(url, {
    method: "GET",
    headers: { AccessKey: STORAGE_PASSWORD, Range: "bytes=0-0" },
  });
  const contentRange = probe.headers.get("content-range") || "";
  const remoteSize = Number((contentRange.match(/\/(\d+)$/) || [])[1] || probe.headers.get("content-length") || 0);
  probe.body?.cancel?.();
  if (!probe.ok || remoteSize !== localSize) {
    throw new Error(`backup verification failed: local ${localSize} bytes, remoto ${remoteSize} bytes`);
  }
  await rm(tarPath, { force: true });
  return { ok: true, backedUp: true, bytes: localSize };
}
