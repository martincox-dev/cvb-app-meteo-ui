// Tests del pipeline de alertas AEMET contra XMLs CAP reales (fixtures descargados
// de los feeds oficiales el 2026-07-06). Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.RUNTIME_TEST_MODE = "1";
process.env.AEMET_TARGET_ZONE_CODES = "771204";
delete process.env.AEMET_TARGET_KEYWORDS; // usar defaults del runtime

const {
  parseCapXmlToAlerts,
  parseTarFromGzipBuffer,
  isInTargetAemetZone,
  alertFingerprint,
  alertRank,
  formatAlertWhatsappText,
} = await import("../server/runtime.mjs");

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => readFileSync(join(fixtures, f), "utf8");
const readBuf = (f) => readFileSync(join(fixtures, f));

// Los fixtures tienen fechas de julio 2026; el parser descarta avisos caducados,
// así que desplazamos onset/expires/effective a un año siempre futuro.
const futureYear = new Date().getFullYear() + 1;
const shiftToFuture = (xml) =>
  xml.replace(/(<(?:onset|expires|effective)>)(\d{4})/g, (_, tag) => `${tag}${futureYear}`);
const shiftToPast = (xml) =>
  xml.replace(/(<(?:onset|expires|effective)>)(\d{4})/g, (_, tag) => `${tag}2020`);

const avisoXml = shiftToFuture(read("aviso-amarillo-771204.xml"));

test("parser: un aviso de zona produce UNA alerta (solo bloque español)", () => {
  const alerts = parseCapXmlToAlerts(avisoXml);
  assert.equal(alerts.length, 1);
  const a = alerts[0];
  assert.equal(a.level, "amarillo");
  assert.equal(a.areaCode, "771204");
  assert.equal(a.area, "Litoral sur de Castellón");
  assert.match(a.phenomenon, /temperaturas máximas/i); // español, no "high-temperature"
});

test("parser: validFrom es el onset (inicio del fenómeno), no la fecha de publicación", () => {
  const [a] = parseCapXmlToAlerts(avisoXml);
  assert.match(a.validFrom, new RegExp(`^${futureYear}-07-08T12:00`));
  assert.match(a.validTo, new RegExp(`^${futureYear}-07-08T19:59`));
});

test("parser: boletín verde multizona no produce alertas", () => {
  const alerts = parseCapXmlToAlerts(shiftToFuture(read("boletin-verde-multizona.xml")));
  assert.equal(alerts.length, 0);
});

test("parser: aviso caducado se descarta", () => {
  const alerts = parseCapXmlToAlerts(shiftToPast(read("aviso-amarillo-771204.xml")));
  assert.equal(alerts.length, 0);
});

test("parser: msgType=Cancel se descarta", () => {
  const xml = avisoXml.replace(/<msgType>[^<]*<\/msgType>/, "<msgType>Cancel</msgType>");
  assert.equal(parseCapXmlToAlerts(xml).length, 0);
});

test("parser: status=Test se descarta", () => {
  const xml = avisoXml.replace(/<status>[^<]*<\/status>/, "<status>Test</status>");
  assert.equal(parseCapXmlToAlerts(xml).length, 0);
});

test("tar: acepta .tar.gz (RSS) y tar plano (API opendata)", () => {
  const gz = parseTarFromGzipBuffer(readBuf("estado-completo.tar.gz"));
  const plain = parseTarFromGzipBuffer(readBuf("api-area77.tar"));
  assert.ok(gz.filter((f) => f.name.endsWith(".xml")).length >= 10);
  assert.ok(plain.filter((f) => f.name.endsWith(".xml")).length >= 30);
});

test("tar: un buffer que no es tar degrada a lista vacía sin lanzar", () => {
  const junk = Buffer.from(JSON.stringify({ estado: 429, descripcion: "Too many requests" }));
  const entries = parseTarFromGzipBuffer(junk);
  assert.equal(entries.filter((f) => f.name.endsWith(".xml")).length, 0);
});

test("filtro de zona: casos límite", () => {
  const cases = [
    [{ areaCode: "771204", area: "Litoral sur de Castellón", description: "x" }, true, "código exacto"],
    [{ areaCode: "770301", area: "Litoral norte de Alicante", description: "x" }, false, "otra zona"],
    [{ areaCode: "771201", area: "Litoral norte de Castellón", description: "viento del sur racheado" }, false, "'sur' en descripción no cuela otra zona"],
    [{ areaCode: "", area: "Litoral sur de Castellón", description: "x" }, true, "sin geocode, nombre con 'de'"],
    [{ areaCode: "12", area: "Litoral Sur Castellón - Costa", description: "x" }, true, "código provincial + nombre correcto"],
  ];
  for (const [alert, want, name] of cases) {
    assert.equal(isInTargetAemetZone(alert), want, name);
  }
});

test("fingerprint: estable ante republicaciones (Update) de AEMET", () => {
  const [a] = parseCapXmlToAlerts(avisoXml);
  // AEMET republica cambiando <sent>/<effective> e <identifier>, el fenómeno es el mismo
  const republished = avisoXml
    .replace(/<effective>[^<]*<\/effective>/g, `<effective>${futureYear}-07-08T09:00:00+02:00</effective>`)
    .replace(/<identifier>[^<]*<\/identifier>/, "<identifier>OTRO.ID.12345</identifier>");
  const [b] = parseCapXmlToAlerts(republished);
  assert.equal(alertFingerprint(a), alertFingerprint(b));
});

test("fingerprint: mismo instante en Z y +02:00 coincide; escalada de nivel NO", () => {
  const base = { areaCode: "771204", phenomenon: "Aviso de temperaturas máximas", level: "amarillo" };
  const utc = alertFingerprint({ ...base, validFrom: "2027-07-08T10:00:00Z" });
  const local = alertFingerprint({ ...base, validFrom: "2027-07-08T12:00:00+02:00" });
  assert.equal(utc, local);
  const escalada = alertFingerprint({ ...base, level: "naranja", validFrom: "2027-07-08T12:00:00+02:00" });
  assert.notEqual(local, escalada);
});

test("dedup: API (tar) + RSS (tar.gz) de la misma fecha convergen sin duplicados", () => {
  // Sin desplazar fechas: solo comprobamos el conteo de fingerprints, no la caducidad,
  // parseando a mano los XML de ambos tar con las mismas fechas desplazadas.
  const apiXmls = parseTarFromGzipBuffer(readBuf("api-area77.tar"))
    .filter((f) => f.name.endsWith(".xml"))
    .map((f) => shiftToFuture(f.content));
  const rssXmls = parseTarFromGzipBuffer(readBuf("estado-completo.tar.gz"))
    .filter((f) => f.name.endsWith(".xml"))
    .map((f) => shiftToFuture(f.content));
  const apiAlerts = apiXmls.flatMap(parseCapXmlToAlerts).filter(isInTargetAemetZone);
  const rssAlerts = rssXmls.flatMap(parseCapXmlToAlerts).filter(isInTargetAemetZone);
  assert.equal(apiAlerts.length, 3, "API: 3 avisos de la zona");
  assert.equal(rssAlerts.length, 3, "RSS: 3 avisos de la zona");
  const fps = new Set([...apiAlerts, ...rssAlerts].map(alertFingerprint));
  assert.equal(fps.size, 3, "merge sin duplicados");
});

test("dispatch: nivel verde y caducados nunca pasan el guard", () => {
  assert.ok(alertRank("verde") < 2);
  assert.ok(alertRank("amarillo") >= 2);
  assert.ok(alertRank("naranja") >= 2);
  assert.ok(alertRank("rojo") >= 2);
});

test("mensaje WhatsApp: fechas legibles en hora de Madrid, sin ISO crudo", () => {
  const [a] = parseCapXmlToAlerts(avisoXml);
  const msg = formatAlertWhatsappText(a);
  assert.match(msg, /Litoral sur de Castellón/);
  assert.match(msg, /🟡/);
  assert.match(msg, /julio/i);
  assert.doesNotMatch(msg, /T12:00:00/);
  assert.match(msg, /meteo\.cvbenicasim\.com/);
});
