// Tests del formato agrupado de avisos (un mensaje por día, varios avisos dentro).
// El requisito crítico aquí NO es estético: es que agrupar no altere la identidad
// de un aviso (alertFingerprint), porque el dedup de "ya enviado" depende de ella.
import test from "node:test";
import assert from "node:assert/strict";

process.env.RUNTIME_TEST_MODE = "1";

const {
  formatAlertGroupText,
  groupAlertsByDay,
  mergeContiguousAlerts,
  alertFingerprint,
  phenomenonShort,
  phenomenonIcon,
  alertHourRange,
  parseCapXmlToAlerts,
} = await import("../server/runtime.mjs");

// Los dos avisos reales del 2026-10-01 (mismos datos que devolvió AEMET)
const lluvias = {
  level: "amarillo",
  phenomenon: "Aviso de lluvias de nivel amarillo",
  area: "Litoral sur de Castellón",
  areaCode: "771204",
  paramCode: "P1",
  description: "Precipitación acumulada en una hora: 30 mm.",
  validFrom: "2026-10-01T14:00:00+02:00",
  validTo: "2026-10-01T23:59:59+02:00",
};
const tormentas = {
  level: "amarillo",
  phenomenon: "Aviso de tormentas de nivel amarillo",
  area: "Litoral sur de Castellón",
  areaCode: "771204",
  paramCode: "TO",
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

test("CRÍTICO: agrupar/formatear no cambia el fingerprint de ningún aviso", () => {
  // Si esto falla, los avisos ya enviados se reenviarían al reagruparse.
  const before = [lluvias, tormentas, naranjaOtroDia].map(alertFingerprint);
  groupAlertsByDay([lluvias, tormentas, naranjaOtroDia]).forEach((batch) => formatAlertGroupText(batch));
  const after = [lluvias, tormentas, naranjaOtroDia].map(alertFingerprint);
  assert.deepEqual(after, before);
});

test("CRÍTICO: formato exacto de la huella (cambiarlo exige migración)", () => {
  // Estas cadenas son las claves con las que se guarda "ya enviado" en BD.
  // Si cambian sin migrar las filas existentes, TODO lo ya enviado vuelve a
  // parecer nuevo y se reenvía al grupo. Ver migración del 2026-10-01 al
  // añadir el parámetro (P1/P2/TO) a la huella.
  assert.equal(
    alertFingerprint(lluvias),
    "771204__aviso de lluvias de nivel amarillo__amarillo__1790856000000__p1"
  );
  assert.equal(
    alertFingerprint(tormentas),
    "771204__aviso de tormentas de nivel amarillo__amarillo__1790856000000__to"
  );
  // Sin parámetro conocido se usa "-" para que el formato sea siempre el mismo
  assert.match(alertFingerprint({ ...lluvias, paramCode: "" }), /__-$/);
});

test("agrupa por día natural: mismo día juntos, días distintos separados", () => {
  const groups = groupAlertsByDay([lluvias, naranjaOtroDia, tormentas]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2, "los dos del 1 de octubre van juntos");
  assert.equal(groups[1].length, 1, "el del 3 de octubre va aparte");
});

test("mensaje del 1 de octubre: un solo mensaje con ambos avisos", () => {
  const msg = formatAlertGroupText([lluvias, tormentas]);
  // "hoy jueves 1" o "jueves 1 de octubre" según cuándo se ejecute el test
  assert.match(msg, /AVISOS AEMET — .*jueves 1/);
  assert.match(msg, /Litoral sur de Castellón/);
  assert.match(msg, /🟡 🌧️ \*Lluvias \(1 h\)\* · 14h → 24h/);
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

// ── Parámetro P1 (1 h) vs P2 (12 h) ────────────────────────────────────────
// Caso real del 29 sept: AEMET avisó naranja por intensidad en 1 h Y amarillo
// por acumulado en 12 h, misma franja. Son dos avisos legítimos, no un error.

const lluvia1h = {
  level: "naranja", phenomenon: "Aviso de lluvias de nivel naranja", paramCode: "P1",
  area: "Litoral sur de Castellón", areaCode: "771204",
  description: "Precipitación acumulada en una hora: 40 mm.",
  validFrom: "2026-09-29T04:00:00+02:00", validTo: "2026-09-29T09:59:59+02:00",
};
const lluvia12h = {
  level: "amarillo", phenomenon: "Aviso de lluvias de nivel amarillo", paramCode: "P2",
  area: "Litoral sur de Castellón", areaCode: "771204",
  description: "Precipitación acumulada en 12 horas: 60 mm.",
  validFrom: "2026-09-29T04:00:00+02:00", validTo: "2026-09-29T09:59:59+02:00",
};

test("P1 y P2 de la misma franja: un mensaje, dos líneas distinguibles", () => {
  const msg = formatAlertGroupText([lluvia1h, lluvia12h]);
  assert.match(msg, /🟠 🌧️ \*Lluvias \(1 h\)\* · 04h → 10h/);
  assert.match(msg, /🟡 🌧️ \*Lluvias \(12 h\)\* · 04h → 10h/);
  // El naranja primero, que es el que manda de un vistazo
  assert.ok(msg.indexOf("(1 h)") < msg.indexOf("(12 h)"));
});

test("fenómenos de un solo parámetro no llevan etiqueta", () => {
  assert.equal(phenomenonShort("Aviso de tormentas de nivel amarillo", "TO"), "Tormentas");
  assert.equal(phenomenonShort("Aviso de temperaturas máximas de nivel naranja", "TA"), "Temperaturas máximas");
});

test("P1 y P2 NO se fusionan aunque compartan franja (son avisos distintos)", () => {
  const merged = mergeContiguousAlerts([lluvia1h, lluvia12h]);
  assert.equal(merged.length, 2);
});

test("CRÍTICO: P1 y P2 del MISMO nivel tienen huellas distintas", () => {
  // El test de arriba usa naranja+amarillo, así que el nivel ya los separaba y
  // no probaba nada. Si AEMET publica los dos parámetros con el mismo nivel y
  // la misma franja, sin el parámetro en la huella uno se descarta en silencio.
  const base = {
    area: "Litoral sur de Castellón", areaCode: "771204", level: "amarillo",
    phenomenon: "Aviso de lluvias de nivel amarillo",
    validFrom: "2026-10-05T14:00:00+02:00", validTo: "2026-10-05T23:59:59+02:00",
  };
  const p1 = { ...base, paramCode: "P1", description: "Precipitación acumulada en una hora: 20 mm." };
  const p2 = { ...base, paramCode: "P2", description: "Precipitación acumulada en 12 horas: 60 mm." };
  assert.notEqual(alertFingerprint(p1), alertFingerprint(p2));

  // Y que sobrevivan los dos al dedup por huella que hace el dispatcher
  const byFp = new Map();
  for (const a of [p1, p2]) {
    const fp = alertFingerprint(a);
    if (!byFp.has(fp)) byFp.set(fp, a);
  }
  assert.equal(byFp.size, 2, "los dos avisos deben sobrevivir al dedup");
  const msg = formatAlertGroupText([...byFp.values()]);
  assert.match(msg, /\(1 h\)/);
  assert.match(msg, /\(12 h\)/);
});

// ── Fusión de franjas contiguas que cruzan la medianoche ───────────────────

const jueTarde = {
  level: "naranja", phenomenon: "Aviso de lluvias de nivel naranja", paramCode: "P1",
  area: "Litoral sur de Castellón",
  description: "Precipitación acumulada en una hora: 50 mm.",
  validFrom: "2026-10-01T14:00:00+02:00", validTo: "2026-10-01T23:59:59+02:00",
};
const vieManana = {
  level: "naranja", phenomenon: "Aviso de lluvias de nivel naranja", paramCode: "P1",
  area: "Litoral sur de Castellón",
  description: "Precipitación acumulada en una hora: 50 mm.",
  validFrom: "2026-10-02T00:00:00+02:00", validTo: "2026-10-02T11:59:59+02:00",
};

test("episodio que cruza medianoche: se une en una sola entrada", () => {
  const merged = mergeContiguousAlerts([jueTarde, vieManana]);
  assert.equal(merged.length, 1, "los dos tramos son un solo episodio");
  assert.equal(merged[0].sources.length, 2, "conserva los dos avisos originales");
  assert.equal(merged[0].validFrom, jueTarde.validFrom);
  assert.equal(merged[0].validTo, vieManana.validTo);
});

test("episodio que cruza medianoche: un único mensaje con rango de días", () => {
  const grupos = groupAlertsByDay(mergeContiguousAlerts([jueTarde, vieManana]));
  assert.equal(grupos.length, 1, "un solo mensaje, no uno por día");
  const msg = formatAlertGroupText(grupos[0]);
  assert.match(msg, /jueves 1 → viernes 2 de octubre/);
  assert.match(msg, /jue 14h → vie 12h/);
});

test("franjas separadas por horas NO se fusionan", () => {
  const manana = { ...jueTarde, validFrom: "2026-10-01T00:00:00+02:00", validTo: "2026-10-01T09:59:59+02:00" };
  const tarde = { ...jueTarde, validFrom: "2026-10-01T14:00:00+02:00", validTo: "2026-10-01T23:59:59+02:00" };
  assert.equal(mergeContiguousAlerts([manana, tarde]).length, 2);
});

test("niveles distintos NO se fusionan aunque las franjas enlacen", () => {
  const vieAmarillo = { ...vieManana, level: "amarillo", phenomenon: "Aviso de lluvias de nivel amarillo" };
  assert.equal(mergeContiguousAlerts([jueTarde, vieAmarillo]).length, 2);
});

test("CRÍTICO: fusionar no altera la huella de los avisos originales", () => {
  const antes = [jueTarde, vieManana].map(alertFingerprint);
  const merged = mergeContiguousAlerts([jueTarde, vieManana]);
  const desdeSources = merged[0].sources.map(alertFingerprint);
  assert.deepEqual(desdeSources, antes, "las huellas de origen se conservan intactas");
});

test("el parser extrae el código de parámetro del CAP", () => {
  const xml = `<alert><status>Actual</status><msgType>Alert</msgType>
    <identifier>TEST.1</identifier>
    <info><language>es-ES</language><severity>Severe</severity>
      <event>Aviso de lluvias de nivel naranja</event>
      <description>Precipitación acumulada en una hora: 40 mm.</description>
      <onset>2099-10-01T14:00:00+02:00</onset><expires>2099-10-01T23:59:59+02:00</expires>
      <parameter><valueName>AEMET-Meteoalerta parametro</valueName><value>P1;Precipitación acumulada en una hora;40 mm</value></parameter>
      <area><areaDesc>Litoral sur de Castellón</areaDesc>
        <geocode><valueName>AEMET-Meteoalerta zona</valueName><value>771204</value></geocode>
      </area>
    </info></alert>`;
  const [a] = parseCapXmlToAlerts(xml);
  assert.equal(a.paramCode, "P1");
  assert.match(formatAlertGroupText([a]), /\*Lluvias \(1 h\)\*/);
});
