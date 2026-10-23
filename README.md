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
| `AEMET_API_KEY` | Clave de AEMET OpenData. **Caduca** y hay que renovarla (la clave no cambia al renovar). Sin ella siguen funcionando los feeds RSS |
| `AEMET_KEY_DEADLINE` | `YYYY-MM-DD`, la fecha límite que indique AEMET al renovar. Activa el aviso 14 días antes |
| `HEALTH_ALERTS_ENABLED` | `true` (por defecto) para el vigilante de salud |
| `HEALTH_ALERT_TO` | Número que recibe los avisos de fallo (por defecto `WHATSAPP_TEST_TO`) |
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

Las dos fuentes se **fusionan y deduplican** (no es una u otra): si la clave de AEMET falla, los avisos siguen llegando por RSS, solo se pierde la redundancia. Se filtra por zona (`AEMET_TARGET_ZONE_CODES`, por defecto `771204`).

Para reenviar algo hay que borrar sus filas en `alert_dispatch_targets` / `alert_send_attempts` (BunnyDB). **Antes de desplegar**, poner `WA_AUTO_SEND_ENABLED=false` y revisar `/api/aemet/dry-run`.

---

## Vigilante de salud

`server/health-watchdog.mjs` comprueba cada 15 min los servicios críticos y avisa al móvil del dueño por la **API oficial de WhatsApp** (plantilla `cvb_alerta_meteo`; no usa Chromium ni la sesión QR):

| Chequeo | Falla si… |
|---|---|
| `aemet_api` | AEMET devuelve 401/403 (clave caducada o revocada) |
| `aemet_rss` | el feed RSS no responde o no es RSS |
| `meta_wa_token` | el token de Meta es inválido (ese aviso no podría enviarse: visible solo en `/api/status`) |
| `bunnydb` | la BD no responde |
| `dispatcher` | el ciclo de envío lleva mucho sin ejecutarse |
| `aemet_key_deadline` | faltan ≤14 días para `AEMET_KEY_DEADLINE` |

Reglas anti-spam: avisa tras **2 pasadas seguidas** fallando, no repite el mismo fallo en menos de 24 h (3 días el plazo de la clave), manda **un solo mensaje por pasada** con todos los fallos, tope de 6 mensajes al día, y avisa también al recuperarse. Si el envío del aviso falla, no lo da por enviado y reintenta. El estado se guarda en la tabla `health_state`. Un 5xx/429/timeout de un tercero cuenta como "desconocido", no como fallo.

Estado actual en `/api/status` → `health_watchdog`.

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
