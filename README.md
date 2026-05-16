# Benica Sail Weather — CVB Meteo Portal

Portal meteorológico del Club de Vela Benicàssim. Frontend React (Base44) + backend Node.js con datos AVAMET, alertas AEMET y envío automático a WhatsApp.

---

## Desarrollo local

```bash
npm install
cp .env.example .env       # completar variables (ver sección Variables)
npm run dev:full           # frontend :5173 + API :3001
```

Para desarrollo solo necesitas AVAMET (sin API key). WhatsApp y Bunny Storage son opcionales en local.

---

## Producción — Bunny Magic Container

### Startup command (panel MC → Entrypoint)

```sh
/bin/sh -c "apk add --no-cache git chromium \
  && export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
  && export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
  && rm -rf /srv/app \
  && git clone --depth=1 https://github.com/martincox-dev/cvb-app-meteo-ui.git /srv/app \
  && cd /srv/app && npm ci --omit=dev \
  && node server/runtime.mjs"
```

> El MC ignora el Dockerfile. El startup command es lo único que importa en producción.

### Health checks (panel MC → Monitoring)

| Tipo       | Protocolo | Puerto | Path      |
|------------|-----------|--------|-----------|
| Startup    | HTTP      | 3001   | /health   |
| Readiness  | HTTP      | 3001   | /health   |
| Liveness   | HTTP      | 3001   | /health   |

### Variables de entorno (panel MC → Environment)

Consulta `.env.example` para la lista completa. Las mínimas para producción:

| Variable | Descripción |
|---|---|
| `PORT` | `3001` |
| `NODE_ENV` | `production` |
| `WA_CLIENT_ID` | `cvb-group-list-temp` |
| `WA_GROUP_IDS` | IDs de grupos separados por coma (Junta CVB primero) |
| `WA_AUTO_SEND_ENABLED` | `true` para activar el envío automático de alertas |
| `BUNNY_STORAGE_HOST` | `storage.bunnycdn.com` |
| `BUNNY_STORAGE_ZONE` | Nombre de la zona (ej. `cvb-meteo-state`) |
| `BUNNY_STORAGE_PASSWORD` | API key de la zona |
| `BUNNY_WA_SESSION_OBJECT` | `state/wa-session.tgz` |
| `AEMET_API_KEY` | Opcional — sin ella se usan los feeds RSS |
| `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN` | BunnyDB para histórico persistente |

---

## Flujo WhatsApp

### Cómo funciona

1. El runtime arranca y, si `BUNNY_STORAGE_*` está configurado, restaura la sesión WA desde Bunny Storage (`/srv/app/.wwebjs_auth`).
2. Cada 3 minutos (`WA_AUTO_SEND_INTERVAL_MS`) comprueba alertas AEMET nuevas.
3. Si hay alerta no enviada: lanza `wa-send-alert-groups.mjs` como proceso hijo, que restaura la sesión, envía el mensaje a todos los grupos configurados y hace backup de la sesión actualizada.
4. Las alertas ya enviadas se deduplicam por huella (área + fenómeno + nivel + periodo) en BunnyDB y en `server/sent-alert-keys.json`.

### Vincular sesión WhatsApp (primera vez o tras expiración)

La sesión WhatsApp está ligada al entorno Chromium del MC. No es portable desde Mac.

```
POST https://meteo.cvbenicasim.com/api/whatsapp/start-qr
```
→ Arranca un proceso Chromium interno que genera el QR.

```
GET  https://meteo.cvbenicasim.com/api/whatsapp/qr
```
→ Abre en el navegador: muestra el QR en HTML (se refresca cada 3 s). Escanea con WhatsApp → Dispositivos vinculados.

Cuando el QR se escanea correctamente los logs del MC muestran:
```
WA autenticado correctamente
WA sesión vinculada — haciendo backup a Bunny Storage...
Sesión guardada en Bunny Storage OK
```
A partir de ese momento la sesión se restaura automáticamente en cada reinicio o redeploy.

### Probar envío manual

```
POST https://meteo.cvbenicasim.com/api/whatsapp/wa-test
```
Envía `🧪 Prueba técnica meteo CVB — sistema OK` al primer grupo de `WA_GROUP_IDS` (Junta CVB). Responde 202 inmediatamente; el envío corre en background. Confirma resultado en los logs del MC.

### Cuándo volver a escanear QR

- WhatsApp desvincula la sesión tras ~14 días sin actividad del dispositivo vinculado.
- Si el MC migra a otro nodo y no hay backup en Bunny Storage.
- Si los logs muestran `Se requiere QR en esta sesión` en los envíos automáticos.

---

## Alertas AEMET → WhatsApp (automático)

```
fetchAemetAlerts()           →  API AEMET oficial (requiere AEMET_API_KEY)
fetchAemetAlertsFromRssCap() →  Feeds RSS/CAP públicos (sin API key)
```

Si hay `AEMET_API_KEY` usa la API; si no, cae back a RSS. En ambos casos filtra por zona (`AEMET_TARGET_ZONE_CODES`) y/o palabras clave (`AEMET_TARGET_KEYWORDS`).

Para forzar un reenvío (p.ej. para pruebas): borrar `server/sent-alert-keys.json` y reiniciar el MC.

---

## Estructura de archivos relevantes

```
server/
  runtime.mjs              ← servidor de producción (AVAMET + alertas + WhatsApp)
  wa-send-alert-groups.mjs ← proceso hijo de envío WA a grupos
  wa-qr-server.mjs         ← proceso hijo para vincular sesión vía QR
  wa-session-storage.mjs   ← backup/restore de sesión WA en Bunny Storage
  index.mjs                ← servidor de desarrollo (sin WhatsApp)
  list-cvb-group.mjs       ← utilidad para listar grupos WA disponibles
  wa-group-test.mjs        ← utilidad para probar envío local
mc-app.json                ← referencia de configuración del MC (no se aplica automáticamente)
.env.example               ← plantilla de variables de entorno
```

---

## Scripts npm

| Script | Uso |
|---|---|
| `npm run dev:full` | Dev: frontend + API (sin WhatsApp) |
| `npm run start` | Producción: `server/runtime.mjs` |
| `npm run wa:send:groups` | Envío manual a grupos (requiere vars WA_*) |
| `npm run wa:test` | Prueba local de sesión WA |
