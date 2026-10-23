// Tests del vigilante de salud. Lo crítico aquí es lo contrario de lo habitual:
// no que avise, sino que NO avise de más (ya hemos tenido spam de WhatsApp).
import test from "node:test";
import assert from "node:assert/strict";
import {
  nextState, sanitizeTemplateParam, buildDigest, digestToTemplateParams,
  aemetDeadlineCheck, createWatchdog,
} from "../server/health-watchdog.mjs";

const T0 = Date.UTC(2026, 9, 23, 8, 0, 0);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const FAIL = { ok: false, detail: "HTTP 401" };
const OK = { ok: true, detail: "OK" };

// ── Máquina de estados ─────────────────────────────────────────────────────

test("un solo fallo NO avisa (umbral de 2 pasadas)", () => {
  const { action, state } = nextState(null, FAIL, T0);
  assert.equal(action, null);
  assert.equal(state.fails, 1);
});

test("dos fallos seguidos avisan una vez", () => {
  const a = nextState(null, FAIL, T0);
  const b = nextState(a.state, FAIL, T0 + 15 * MIN);
  assert.equal(b.action, "alert");
  assert.equal(b.state.alertedAt, T0 + 15 * MIN);
});

test("CRÍTICO: un fallo ya avisado NO se repite antes de 24 h", () => {
  let s = nextState(nextState(null, FAIL, T0).state, FAIL, T0 + 15 * MIN).state;
  let t = T0 + 15 * MIN;
  let avisos = 0;
  // Pasadas cada 15 min durante casi 24 h
  while (t < T0 + 15 * MIN + DAY - 15 * MIN) {
    t += 15 * MIN;
    const r = nextState(s, FAIL, t);
    if (r.action) avisos += 1;
    s = r.state;
  }
  assert.equal(avisos, 0, "ni un mensaje más durante 24 h de fallo continuado");
});

test("pasadas 24 h manda UN recordatorio, no uno por pasada", () => {
  let s = nextState(nextState(null, FAIL, T0).state, FAIL, T0 + 15 * MIN).state;
  const r1 = nextState(s, FAIL, T0 + 15 * MIN + DAY);
  assert.equal(r1.action, "reminder");
  const r2 = nextState(r1.state, FAIL, T0 + 30 * MIN + DAY);
  assert.equal(r2.action, null);
});

test("fallo intermitente (falla, ok, falla) no avisa nunca", () => {
  let s = nextState(null, FAIL, T0).state;
  s = nextState(s, OK, T0 + 15 * MIN).state;
  const r = nextState(s, FAIL, T0 + 30 * MIN);
  assert.equal(r.action, null);
  assert.equal(r.state.fails, 1, "el contador se reinició con el ok");
});

test("recuperación: se anuncia solo si antes se avisó del fallo", () => {
  const avisado = nextState(nextState(null, FAIL, T0).state, FAIL, T0 + 15 * MIN).state;
  assert.equal(nextState(avisado, OK, T0 + 30 * MIN).action, "recovered");
  // Fallo que nunca llegó a avisarse: recuperación silenciosa
  const sinAvisar = nextState(null, FAIL, T0).state;
  assert.equal(nextState(sinAvisar, OK, T0 + 15 * MIN).action, null);
});

test("'desconocido' (ok:null) no cuenta como fallo ni como recuperación", () => {
  const avisado = nextState(nextState(null, FAIL, T0).state, FAIL, T0 + 15 * MIN).state;
  const r = nextState(avisado, { ok: null, detail: "timeout" }, T0 + 30 * MIN);
  assert.equal(r.action, null);
  assert.deepEqual(r.state, avisado);
  // y un timeout tampoco acerca un chequeo sano al umbral
  const sano = nextState(null, FAIL, T0).state;
  assert.equal(nextState(sano, { ok: null }, T0 + 15 * MIN).state.fails, 1);
});

test("umbral personalizado de 1 avisa a la primera", () => {
  assert.equal(nextState(null, FAIL, T0, { failThreshold: 1 }).action, "alert");
});

// ── Parámetros de plantilla de Meta ────────────────────────────────────────

test("parámetros: sin saltos de línea, sin espacios múltiples, nunca vacíos", () => {
  assert.equal(sanitizeTemplateParam("a\nb\t c    d"), "a b c d");
  assert.equal(sanitizeTemplateParam(""), "-");
  assert.equal(sanitizeTemplateParam(null), "-");
  assert.equal(sanitizeTemplateParam("   "), "-");
  assert.ok(sanitizeTemplateParam("x".repeat(900), 400).length <= 400);
  assert.ok(sanitizeTemplateParam("x".repeat(900), 400).endsWith("…"));
});

test("digest → 6 parámetros válidos, en el orden de la plantilla", () => {
  const digest = buildDigest([{
    action: "alert", since: T0,
    check: { label: "Clave de la API de AEMET", hint: "Renuévala en AEMET OpenData." },
    result: { detail: "HTTP 401" },
  }]);
  const p = digestToTemplateParams(digest);
  assert.equal(p.length, 6);
  assert.equal(p[0], "Sistema meteo CVB");
  assert.equal(p[1], "FALLO");
  assert.equal(p[2], "Clave de la API de AEMET");
  assert.match(p[3], /HTTP 401/);
  assert.match(p[3], /Renuévala/);
  for (const x of p) {
    assert.ok(x.length > 0);
    assert.doesNotMatch(x, /[\n\r\t]| {2,}/);
  }
});

test("digest con varios fallos: un solo resumen", () => {
  const d = buildDigest([
    { action: "alert", since: T0, check: { label: "Clave de AEMET" }, result: { detail: "401" } },
    { action: "alert", since: T0, check: { label: "Token de Meta" }, result: { detail: "inválido" } },
  ]);
  assert.equal(d.titulo, "2 fallos del sistema");
  assert.match(d.detalle, /Clave de AEMET/);
  assert.match(d.detalle, /Token de Meta/);
});

test("digest de recuperación y de recordatorio", () => {
  const rec = buildDigest([{ action: "recovered", since: T0, check: { label: "Clave de AEMET" }, result: { detail: "OK" } }]);
  assert.equal(rec.nivel, "RECUPERADO");
  const recordatorio = buildDigest([{ action: "reminder", since: T0, check: { label: "BD" }, result: { detail: "caída" } }]);
  assert.equal(recordatorio.nivel, "RECORDATORIO");
});

// ── Plazo de la clave de AEMET ─────────────────────────────────────────────

test("plazo de la clave: sin fecha configurada no molesta", async () => {
  const c = aemetDeadlineCheck({ deadline: "" });
  assert.equal((await c.run()).ok, true);
});

test("plazo de la clave: avisa solo en las 2 últimas semanas", async () => {
  const now = () => Date.parse("2026-10-23T08:00:00Z");
  assert.equal((await aemetDeadlineCheck({ deadline: "2027-03-15", now }).run()).ok, true);
  assert.equal((await aemetDeadlineCheck({ deadline: "2026-11-05", now }).run()).ok, false, "13 días: avisa");
  const caducada = await aemetDeadlineCheck({ deadline: "2026-10-15", now }).run();
  assert.equal(caducada.ok, false);
  assert.match(caducada.detail, /caducó/);
  assert.equal((await aemetDeadlineCheck({ deadline: "no-es-fecha", now }).run()).ok, false);
});

// ── Orquestador ────────────────────────────────────────────────────────────

function harness(checkDefs, { maxMessagesPerDay } = {}) {
  const states = new Map();
  const sent = [];
  let clock = T0;
  let notifyShouldFail = false;
  const wd = createWatchdog({
    checks: checkDefs,
    store: { load: async (n) => states.get(n) ?? null, save: async (n, s) => { states.set(n, s); } },
    notify: async (digest) => { if (notifyShouldFail) throw new Error("Meta caída"); sent.push(digest); },
    now: () => clock,
    maxMessagesPerDay,
    log: { error: () => {} },
  });
  return { wd, sent, states, advance: (ms) => { clock += ms; }, failNotify: (v) => { notifyShouldFail = v; } };
}
const mkCheck = (name, resultRef) => ({ name, label: name, run: async () => resultRef.value });

test("orquestador: varios chequeos fallando = UN solo mensaje", async () => {
  const a = { value: FAIL }, b = { value: FAIL }, c = { value: OK };
  const h = harness([mkCheck("a", a), mkCheck("b", b), mkCheck("c", c)]);
  await h.wd.runOnce();
  assert.equal(h.sent.length, 0, "primera pasada: aún no");
  h.advance(15 * MIN);
  const r = await h.wd.runOnce();
  assert.equal(r.sent, true);
  assert.equal(h.sent.length, 1, "un único mensaje para a y b");
  assert.match(h.sent[0].detalle, /a: HTTP 401/);
  assert.match(h.sent[0].detalle, /b: HTTP 401/);
});

test("CRÍTICO: 48 h de fallo continuado = 1 aviso + 1 recordatorio, no un chorro", async () => {
  const a = { value: FAIL };
  const h = harness([mkCheck("a", a)]);
  for (let i = 0; i < 48 * 4; i++) { await h.wd.runOnce(); h.advance(15 * MIN); }
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].nivel, "FALLO");
  assert.equal(h.sent[1].nivel, "RECORDATORIO");
});

test("si el envío del aviso falla, se reintenta en la pasada siguiente", async () => {
  const a = { value: FAIL };
  const h = harness([mkCheck("a", a)]);
  h.failNotify(true);
  await h.wd.runOnce();
  h.advance(15 * MIN);
  const fallido = await h.wd.runOnce();
  assert.equal(fallido.sent, false);
  assert.equal(h.states.get("a").alertedAt, null, "NO se marcó como avisado");
  h.failNotify(false);
  h.advance(15 * MIN);
  const ok = await h.wd.runOnce();
  assert.equal(ok.sent, true);
  assert.equal(h.sent.length, 1);
});

test("recuperación tras avisar: llega un mensaje 'RECUPERADO'", async () => {
  const a = { value: FAIL };
  const h = harness([mkCheck("a", a)]);
  await h.wd.runOnce(); h.advance(15 * MIN); await h.wd.runOnce();
  a.value = OK; h.advance(15 * MIN);
  await h.wd.runOnce();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].nivel, "RECUPERADO");
});

test("una excepción dentro de un chequeo cuenta como fallo, sin romper la pasada", async () => {
  const boom = { name: "boom", label: "boom", run: async () => { throw new Error("kaboom"); } };
  const ok = mkCheck("ok", { value: OK });
  const h = harness([boom, ok]);
  await h.wd.runOnce(); h.advance(15 * MIN);
  await h.wd.runOnce();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].detalle, /kaboom/);
});

test("tope diario de mensajes", async () => {
  // 3 chequeos que alternan fallo/recuperación generarían muchos mensajes
  const refs = [{ value: FAIL }, { value: FAIL }, { value: FAIL }];
  const h = harness(refs.map((r, i) => mkCheck(`c${i}`, r)), { maxMessagesPerDay: 2 });
  for (let ciclo = 0; ciclo < 6; ciclo++) {
    refs.forEach((r) => { r.value = FAIL; });
    await h.wd.runOnce(); h.advance(15 * MIN); await h.wd.runOnce(); h.advance(15 * MIN);
    refs.forEach((r) => { r.value = OK; });
    await h.wd.runOnce(); h.advance(15 * MIN);
  }
  assert.ok(h.sent.length <= 2, `se enviaron ${h.sent.length}, el tope es 2`);
});

test("getSnapshot refleja el último estado", async () => {
  const a = { value: FAIL };
  const h = harness([mkCheck("a", a)]);
  await h.wd.runOnce();
  const snap = h.wd.getSnapshot();
  assert.equal(snap.checks.a.ok, false);
  assert.equal(snap.lastRun, T0);
});
