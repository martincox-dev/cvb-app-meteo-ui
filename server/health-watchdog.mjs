// Vigilante de salud del sistema: detecta fallos críticos (clave de AEMET
// caducada, token de Meta inválido, BD caída, dispatcher parado…) y avisa al
// dueño por la API oficial de WhatsApp. Existe porque /api/status ya detectó la
// caducidad de la clave de AEMET el 2026-10-21, pero nadie lo miraba.
//
// Sin dependencias de red ni de runtime.mjs: toda la lógica de decisión está
// aquí y se prueba con mocks. runtime.mjs aporta los chequeos reales.
//
// Reglas pensadas para NO convertirse en otra fuente de spam:
//  - un fallo solo se avisa tras N pasadas seguidas (por defecto 2)
//  - un fallo ya avisado no se repite hasta pasadas 24 h (recordatorio)
//  - un único mensaje por pasada, aunque fallen varios chequeos (resumen)
//  - tope de mensajes por día
//  - si el envío del aviso falla, NO se da por avisado y se reintenta
//  - "desconocido" (ok:null: timeout, 5xx de un tercero…) no cuenta como fallo

const DAY_MS = 86400000;

export const WATCHDOG_DEFAULTS = {
  failThreshold: 2,
  repeatEveryMs: DAY_MS,
  maxMessagesPerDay: 6,
};

/**
 * Transición de estado de UN chequeo.
 * @param prev   estado anterior ({status, fails, alertedAt, since}) o null
 * @param result {ok: true|false|null, detail}  null = no se pudo determinar
 * @returns {state, action}  action: null | "alert" | "reminder" | "recovered"
 *   `state` asume que el aviso SÍ se enviará; si no se envía, quien llama debe
 *   restaurar alertedAt al valor previo para que se reintente.
 */
export function nextState(prev, result, now, opts = {}) {
  const failThreshold = opts.failThreshold ?? WATCHDOG_DEFAULTS.failThreshold;
  const repeatEveryMs = opts.repeatEveryMs ?? WATCHDOG_DEFAULTS.repeatEveryMs;
  const base = prev || { status: "ok", fails: 0, alertedAt: null, since: now };

  if (result.ok === null || result.ok === undefined) return { state: base, action: null };

  if (result.ok) {
    return {
      state: { status: "ok", fails: 0, alertedAt: null, since: base.status === "ok" ? base.since : now },
      // Solo se anuncia la recuperación si antes se avisó del fallo
      action: base.alertedAt ? "recovered" : null,
    };
  }

  const fails = base.fails + 1;
  const since = base.status === "fail" ? base.since : now;
  let action = null;
  let alertedAt = base.alertedAt;
  if (fails >= failThreshold) {
    if (!alertedAt) {
      action = "alert";
      alertedAt = now;
    } else if (now - alertedAt >= repeatEveryMs) {
      action = "reminder";
      alertedAt = now;
    }
  }
  return { state: { status: "fail", fails, alertedAt, since }, action };
}

// Los parámetros de plantilla de la API de Meta no admiten saltos de línea,
// tabuladores ni más de 4 espacios seguidos, y no pueden ir vacíos.
export function sanitizeTemplateParam(value, max = 400) {
  const s = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  const cut = s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  return cut || "-";
}

const madridTime = (ms) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));

/**
 * Un único resumen para todo lo que cambió en esta pasada.
 * items: [{action, check:{label}, result:{detail}, since}]
 */
export function buildDigest(items) {
  const problems = items.filter((i) => i.action === "alert" || i.action === "reminder");
  const recovered = items.filter((i) => i.action === "recovered");
  const labels = (list) => list.map((i) => i.check.label).join(", ");

  if (!problems.length) {
    return {
      nivel: "RECUPERADO",
      titulo: recovered.length === 1 ? recovered[0].check.label : `${recovered.length} chequeos recuperados`,
      detalle: `Vuelve a funcionar: ${labels(recovered)}.`,
      desde: madridTime(Math.min(...recovered.map((i) => i.since))),
      hasta: "resuelto",
    };
  }

  const onlyReminders = problems.every((i) => i.action === "reminder");
  const parts = problems.map((i) => `${i.check.label}: ${i.result.detail}`);
  if (recovered.length) parts.push(`(recuperado: ${labels(recovered)})`);
  const hint = problems.find((i) => i.check.hint)?.check.hint;
  if (hint) parts.push(hint);

  return {
    nivel: onlyReminders ? "RECORDATORIO" : "FALLO",
    titulo: problems.length === 1 ? problems[0].check.label : `${problems.length} fallos del sistema`,
    detalle: parts.join(" | "),
    desde: madridTime(Math.min(...problems.map((i) => i.since))),
    hasta: "sin resolver",
  };
}

// Orden de los 6 parámetros de la plantilla cvb_alerta_meteo:
// zona, nivel, fenómeno, descripción, desde, hasta
export function digestToTemplateParams(digest) {
  return [
    "Sistema meteo CVB",
    digest.nivel,
    digest.titulo,
    sanitizeTemplateParam(digest.detalle, 600),
    digest.desde,
    digest.hasta,
  ].map((s) => sanitizeTemplateParam(s));
}

/**
 * Aviso previo a la caducidad de la clave de AEMET. La clave NO cambia al
 * renovarla (el JWT no lleva fecha), así que el plazo hay que configurarlo a
 * mano con la fecha que dé AEMET: AEMET_KEY_DEADLINE=YYYY-MM-DD.
 */
export function aemetDeadlineCheck({ deadline, now = () => Date.now(), warnDays = 14 }) {
  return {
    name: "aemet_key_deadline",
    label: "Plazo de la clave de AEMET",
    hint: "La clave no cambia al renovarla: actualiza AEMET_KEY_DEADLINE con la nueva fecha.",
    opts: { failThreshold: 1, repeatEveryMs: 3 * DAY_MS },
    run: async () => {
      if (!deadline) return { ok: true, detail: "sin fecha configurada" };
      const end = Date.parse(`${deadline}T23:59:59+02:00`);
      if (Number.isNaN(end)) return { ok: false, detail: `AEMET_KEY_DEADLINE inválida: "${deadline}"` };
      const daysLeft = Math.ceil((end - now()) / DAY_MS);
      if (daysLeft > warnDays) return { ok: true, detail: `quedan ${daysLeft} días` };
      return {
        ok: false,
        detail: daysLeft >= 0
          ? `la clave caduca el ${deadline} (quedan ${daysLeft} días). Renuévala en AEMET OpenData.`
          : `la clave caducó el ${deadline} (hace ${-daysLeft} días). Renuévala en AEMET OpenData.`,
      };
    },
  };
}

/**
 * @param checks  [{name, label, hint?, opts?, run: async () => ({ok, detail})}]
 * @param notify  async (digest) => void ; debe lanzar si no pudo enviar
 * @param store   {load(name) => state|null, save(name, state, detail)}
 */
export function createWatchdog({ checks, notify, store, now = () => Date.now(), maxMessagesPerDay = WATCHDOG_DEFAULTS.maxMessagesPerDay, log = console }) {
  let lastRun = null;
  let snapshot = {};
  let sentToday = { day: "", count: 0 };

  async function runOnce() {
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (sentToday.day !== day) sentToday = { day, count: 0 };

    const items = [];
    const nextSnapshot = {};
    for (const check of checks) {
      let result;
      try {
        result = await check.run();
      } catch (err) {
        result = { ok: false, detail: `error al comprobar: ${err?.message || err}` };
      }
      const prev = await store.load(check.name);
      const { state, action } = nextState(prev, result, t, check.opts);
      nextSnapshot[check.name] = { ok: result.ok, detail: result.detail, fails: state.fails, alerted: Boolean(state.alertedAt) };
      if (action) {
        items.push({ action, check, result, since: state.since, state, prevAlertedAt: prev?.alertedAt ?? null });
      } else {
        await store.save(check.name, state, result.detail);
      }
    }
    snapshot = nextSnapshot;
    lastRun = t;

    if (!items.length) return { sent: false, items: 0 };

    // Si no se llega a enviar, se restaura alertedAt para reintentar en la próxima pasada
    const unsent = (it) => ({ ...it.state, alertedAt: it.prevAlertedAt });

    if (sentToday.count >= maxMessagesPerDay) {
      log.error?.(`health-watchdog: tope diario (${maxMessagesPerDay}) alcanzado, ${items.length} aviso(s) aplazados`);
      for (const it of items) await store.save(it.check.name, unsent(it), it.result.detail);
      return { sent: false, items: items.length, capped: true };
    }

    try {
      await notify(buildDigest(items));
      sentToday.count += 1;
      for (const it of items) await store.save(it.check.name, it.state, it.result.detail);
      return { sent: true, items: items.length };
    } catch (err) {
      log.error?.(`health-watchdog: no se pudo enviar el aviso (${items.length}): ${err?.message || err}`);
      for (const it of items) await store.save(it.check.name, unsent(it), it.result.detail);
      return { sent: false, items: items.length, error: String(err?.message || err) };
    }
  }

  return {
    runOnce,
    getSnapshot: () => ({ lastRun, checks: snapshot }),
  };
}
