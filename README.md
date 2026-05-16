# Benica Sail Weather

Portal meteo CVB con interfaz Base44 y backend API propia.

## Desarrollo local

1. `npm install`
2. `cp .env.example .env`
3. Completar claves (`AEMET_API_KEY`, opcional `WINDY_API_KEY`)
4. `npm run dev:full`

URLs:
- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api/meteo`

## Producción (Bunny Container)

- Dockerfile incluido.
- Puerto interno: `3001`.
- Variables de entorno: usar `.env.example` como referencia.
- Comando runtime: `npm run start`.

## Alertas AEMET -> WhatsApp (autómatico)

Estado actual:
- El runtime envía alertas AEMET nuevas automáticamente a los grupos `Junta CVB` y `CVB`.
- Usa `whatsapp-web.js` con verificación de `ack` (mínimo `ack>=1`) por grupo.
- Deduplica alertas (no reenvía el mismo aviso dos veces).

Archivos relevantes:
- `server/runtime.mjs` (polling AEMET + dedupe + disparo envío)
- `server/wa-send-alert-groups.mjs` (envío a grupos + comprobación ack)
- `server/sent-alert-keys.json` (histórico de huellas ya enviadas)
- `whatsapp-groups.local` (IDs de grupos; local, no versionado)
- `.wwebjs_auth/` (sesión de WhatsApp; local/persistente, no versionado)

Variables importantes:
- `WA_AUTO_SEND_ENABLED=true`
- `WA_AUTO_SEND_INTERVAL_MS=180000` (3 min)
- `WA_CLIENT_ID=cvb-group-list-temp`
- `WA_GROUP_IDS` (opcional; si no existe usa `whatsapp-groups.local`)

Qué tienes que hacer:
1. Mantener la sesión vinculada de WhatsApp activa en el dispositivo.
2. Mantener persistente `.wwebjs_auth` en el entorno donde corra producción.
3. No borrar `server/sent-alert-keys.json` salvo que quieras permitir reenvío histórico.
4. Tras cambios de código: redeploy/restart de `cvb-meteo-portal`.

Qué debes evitar:
- No borrar `.wwebjs_auth` (forzará QR de nuevo).
- No desvincular el dispositivo desde WhatsApp móvil si quieres continuidad automática.
- No ejecutar múltiples procesos `whatsapp-web.js` con el mismo `clientId` a la vez.

## Gráfica de viento horario

Estado actual:
- Muestra las últimas 24 horas reales de muestras interpoladas AVAMET.
- Etiqueta en hora local del servidor (Europe/Madrid en Bunny Madrid).
