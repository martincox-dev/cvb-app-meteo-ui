// Tests del formato agrupado de avisos (un mensaje por día, varios avisos dentro).
// El requisito crítico aquí NO es estético: es que agrupar no altere la identidad
// de un aviso (alertFingerprint), porque el dedup de "ya enviado" depende de ella.
import test from "node:test";
import assert from "node:assert/strict";

process.env.RUNTIME_TEST_MODE = "1";

const {
  formatAlertGroupText,
  groupAlertsByDay,
  alertFingerprint,
  phenomenonShort,
  phenomenonIcon,
  alertHourRange,
} = await import("../server/runtime.mjs");

// Los dos avisos reales del 2026-10-01 (mismos datos que devolvió AEMET)
const lluvias = {
  level: "amarillo",
  phenomenon: "Aviso de lluvias de nivel amarillo",
  area: "Litoral sur de Castellón",
  areaCode: "771204",
  description: "Precipitación acumulada en una hora: 30 mm.",
  validFrom: "2026-10-01T14:00:00+02:00",
  validTo: "2026-10-01T23:59:59+02:00",
};
const tormentas = {
  level: "amarillo",
  phenomenon: "Aviso de tormentas de nivel amarillo",
  area: "Litoral sur de Castellón",
  areaCode: "771204",
  description: "Posible granizo y rachas muy fuertes de viento.",
  validFrom: "2026-10-01T14:00:00+02:00",
  validTo: "2026-10-01T23:59:59+02:00",
};
const naranjaOtroDia = {
  level: "naranja",
  phenomenon: "Aviso de temperaturas máximas de nivel naranja",
  area: "Litoral sur de Castellón",
  areaCode: "771204",
  description: "Temperatura máxima: 38 ºC.",
  validFrom: "2026-10-03T13:00:00+02:00",
  validTo: "2026-10-03T20:59:59+02:00",
};

test("CRÍTICO: agrupar no cambia el fingerprint de ningún aviso", () => {
  // Si esto falla, los avisos ya enviados se reenviarían al reagruparse.
  const before = [lluvias, tormentas, naranjaOtroDia].map(alertFingerprint);
  groupAlertsByDay([lluvias, tormentas, naranjaOtroDia]).forEach((batch) => formatAlertGroupText(batch));
  const after = [lluvias, tormentas, naranjaOtroDia].map(alertFingerprint);
  assert.deepEqual(after, before);
  // Y coinciden exactamente con las huellas que ya están marcadas como enviadas
  assert.equal(before[0], "771204__aviso de lluvias de nivel amarillo__amarillo__1790856000000");
  assert.equal(before[1], "771204__aviso de tormentas de nivel amarillo__amarillo__1790856000000");
});

test("agrupa por día natural: mismo día juntos, días distintos separados", () => {
  const groups = groupAlertsByDay([lluvias, naranjaOtroDia, tormentas]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2, "los dos del 1 de octubre van juntos");
  assert.equal(groups[1].length, 1, "el del 3 de octubre va aparte");
});

test("mensaje del 1 de octubre: un solo mensaje con ambos avisos", () => {
  const msg = formatAlertGroupText([lluvias, tormentas]);
  assert.match(msg, /AVISOS AEMET — jueves 1 de octubre/);
  assert.match(msg, /Litoral sur de Castellón/);
  assert.match(msg, /🟡 🌧️ \*Lluvias\* · 14h → 24h/);
  assert.match(msg, /🟡 ⚡️ \*Tormentas\* · 14h → 24h/);
  assert.match(msg, /Precipitación acumulada en una hora: 30 mm\./);
  assert.match(msg, /Posible granizo y rachas muy fuertes de viento\./);
  assert.match(msg, /meteo\.cvbenicasim\.com/);
  // El nivel ya lo dice el círculo: no debe repetirse en texto
  assert.doesNotMatch(msg, /de nivel amarillo/);
  // Ni fechas ISO crudas
  assert.doesNotMatch(msg, /T14:00:00/);
});

test("ordena por gravedad: naranja antes que amarillo", () => {
  const mismoDia = { ...naranjaOtroDia, validFrom: "2026-10-01T18:00:00+02:00", validTo: "2026-10-01T20:59:59+02:00" };
  const msg = formatAlertGroupText([lluvias, mismoDia]);
  assert.ok(msg.indexOf("🟠") < msg.indexOf("🟡"), "el naranja va primero");
});

test("cabecera relativa: hoy / mañana / fecha completa", () => {
  const hoy = new Date();
  const enDosHoras = new Date(hoy.getTime() + 2 * 3600 * 1000).toISOString();
  const manana = new Date(hoy.getTime() + 26 * 3600 * 1000).toISOString();
  assert.match(formatAlertGroupText([{ ...lluvias, validFrom: enDosHoras, validTo: enDosHoras }]), /— hoy /);
  assert.match(formatAlertGroupText([{ ...lluvias, validFrom: manana, validTo: manana }]), /— mañana /);
});

test("franja horaria: :59:59 se muestra como el final de esa hora", () => {
  assert.equal(alertHourRange("2026-10-01T14:00:00+02:00", "2026-10-01T23:59:59+02:00"), "14h → 24h");
  assert.equal(alertHourRange("2026-10-01T12:00:00+02:00", "2026-10-01T19:59:59+02:00"), "12h → 20h");
});

test("nombre corto e icono por fenómeno", () => {
  assert.equal(phenomenonShort("Aviso de tormentas de nivel amarillo"), "Tormentas");
  assert.equal(phenomenonShort("Aviso de temperaturas máximas de nivel naranja"), "Temperaturas máximas");
  assert.equal(phenomenonIcon("Aviso de tormentas de nivel amarillo"), "⚡️");
  assert.equal(phenomenonIcon("Aviso de lluvias de nivel amarillo"), "🌧️");
  assert.equal(phenomenonIcon("Aviso costero de nivel amarillo"), "🌊");
  assert.equal(phenomenonIcon("Aviso de viento de nivel amarillo"), "💨");
});

test("descripción larga se recorta a 140 caracteres", () => {
  const msg = formatAlertGroupText([{ ...lluvias, description: "x".repeat(300) }]);
  const linea = msg.split("\n").find((l) => l.startsWith("x"));
  assert.ok(linea.length <= 140, `la línea mide ${linea.length}`);
  assert.ok(linea.endsWith("…"));
});

test("aviso sin descripción no deja una línea vacía suelta", () => {
  const msg = formatAlertGroupText([{ ...lluvias, description: "" }]);
  assert.doesNotMatch(msg, /\n\n\n/);
});
