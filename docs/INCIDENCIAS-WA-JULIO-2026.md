# Incidencias del envío de alertas por WhatsApp — julio 2026

Sistema afectado: portal meteo CVB (meteo.cvbenicasim.com), despacho automático de avisos
AEMET (zona 771204, Litoral sur de Castellón) a los grupos de WhatsApp **Junta CVB** y **CVB**
mediante whatsapp-web.js (sesión vinculada por QR, Chromium headless en el Magic Container de Bunny).

Documento escrito el 2026-07-18. Cubre las dos incidencias de reenvío masivo (15 y 18 de julio).
Como antecedente relevante se incluye un resumen de la incidencia previa del 7–9 de julio, porque
sus arreglos son la base sobre la que ocurrieron las otras dos.

---

## Antecedente: incidencia del 7–9 de julio (alertas no enviadas)

**Síntoma:** dos avisos amarillos activos (7 y 8 de julio) caducaron sin llegar a los grupos.

**Causas encadenadas:**
1. La sesión de WhatsApp guardada en Bunny Storage era inválida (el tgz se había subido corrupto:
   se comprimía el perfil con Chromium aún abierto escribiéndolo).
2. Al restaurar la sesión inválida, whatsapp-web.js pedía QR; el script de envío solo lo logeaba
   y esperaba indefinidamente (sin timeout).
3. El dispatcher esperaba la salida de ese proceso colgado con el flag `AUTO_SEND_RUNNING`
   activado, así que todos los ciclos posteriores se saltaron en silencio durante 2 días.

**Arreglos aplicados** (commits `653ef5d`, `c955c1e`, `48ffbaf`, `5010a15`, `28c47d8`, `1a79fd7`, `608658e`):
- Watchdog global en el script de envío (exit 4) y kill duro desde el runtime al árbol de
  procesos completo (`kill(-pid)`, 8 min) — un envío colgado nunca vuelve a bloquear el dispatcher.
- Salida inmediata con código de error si la sesión pide QR (exit 5) o falla la autenticación (exit 6).
- Backup de sesión: cerrar Chromium **antes** de comprimir; verificar integridad del tgz antes de
  subir; verificar tamaño remoto tras subir (GET con Range, Bunny no acepta HEAD).
- Restore: verificar el tgz descargado **antes** de borrar la sesión local.
- Envíos serializados con mutex (dos Chromium sobre el mismo perfil se bloqueaban mutuamente).
- Sesión local persistente entre intentos (la sincronización inicial de WA Web tarda minutos
  y antes se reseteaba en cada intento); `protocolTimeout` de puppeteer a 10 min.
- Re-vinculación por QR: el proceso QR arranca limpio sin restaurar la sesión muerta.

**Resolución:** re-vinculación por QR el día 9 y entrega verificada de un aviso real a ambos
grupos (ack=1) a las 07:35Z. Registrado en BD.

---

## Incidencia 1 — 15 de julio: reenvío en bucle infinito (~cada 5 min)

### Síntoma
El mismo aviso de AEMET llegó repetido a los grupos una y otra vez, aproximadamente cada
5 minutos, durante un período prolongado. Se detuvo únicamente cuando el usuario entró en el
panel de Bunny y des-deployó el Magic Container manualmente.

### Cronología (reconstruida desde la BD; los logs del contenedor se perdieron con el undeploy)
- **14 jul 09:35Z** — el aviso amarillo de temperaturas máximas del día 15 se envía correctamente
  y queda registrado en `alert_dispatches` (envío anticipado, AEMET lo publicó la víspera).
- **15 jul** — AEMET publica/reedita otro aviso (nuevo fingerprint). El dispatcher lo envía; el
  mensaje **llega al grupo**, pero el proceso de envío devuelve error (ver causa raíz), así que el
  fingerprint **no** se registra como enviado.
- Cada ciclo (3 min de intervalo + ~2 min que dura el envío ≈ 5 min) repite el envío completo:
  mensaje real entregado + «fallo» fantasma + reintento. Bucle sin fin.
- El usuario des-deploya el MC para cortar el spam. En `alert_dispatches` no hay ni un solo
  registro del día 15: para el sistema, «nunca envió nada».

### Causa raíz
El script de envío exigía **ack ≥ 1** (confirmación de servidor de WhatsApp) en ~12 segundos
para dar el envío por bueno (`exit 2` en caso contrario). El móvil del usuario estaba **fuera de
cobertura** en ese período y el ack no se confirmaba a tiempo, aunque el mensaje sí se entregaba.
Resultado: entrega real tratada como fallo → sin registro de fingerprint → reintento infinito.
Patrón clásico de **reintentos sin idempotencia**: confundir «sin confirmación» con «no enviado».

### Factor contribuyente
El móvil fuera de cobertura (intuición correcta del usuario). Con el teléfono online el ack
llega en segundos y el problema no se manifiesta — por eso la verificación del día 9 funcionó.

### Arreglos aplicados (commit `3bff76b`, 16 jul)
1. **Criterio de éxito corregido:** éxito = `sendMessage` devuelve id de mensaje. El ack pasa a
   ser solo informativo en el log; nunca decide el código de salida.
2. **Tope duro de reintentos:** máximo **3 intentos de envío por fingerprint**, contador
   persistido en BD (tabla nueva `alert_send_attempts`, cargada al arrancar). El intento se
   apunta **antes** de enviar. El dry-run muestra los avisos agotados como `reintentos_agotados`.
   Garantía matemática: ningún aviso puede generar más de 3 mensajes, falle lo que falle.

---

## Incidencia 2 — 18 de julio: 3 mensajes duplicados por grupo

### Síntoma
Un aviso amarillo de tormentas (para el 19 de julio, 16:00–20:00) llegó **3 veces** a cada
grupo entre las 16:24Z y las 16:30Z. A diferencia del día 15, el sistema **se detuvo solo**
tras el tercer intento. El usuario, con la confianza ya agotada, des-deployó el MC de nuevo.

### Cronología (logs del contenedor)
- **16:24:56Z** — intento 1: `Enviado ... ack=0 id=undefined` en ambos grupos →
  `sendMessage sin id de mensaje` → exit 2 → sin registro.
- **16:27:5x** — intento 2: idéntico.
- **16:30:2x** — intento 3: idéntico. El contador llega a 3.
- **16:33Z** — ciclo siguiente: el aviso aparece como `reintentos_agotados`. No hay más envíos.
  El tope de la incidencia 1 funcionó exactamente como se diseñó.

### Causa raíz
Con la versión actual de WhatsApp Web, whatsapp-web.js 1.34.x devuelve un objeto `Message`
**vacío** al enviar: `id = undefined`, `ack = 0` — **aunque el mensaje se entrega realmente**.
Es un fallo de serialización interno de la librería (scraping no oficial que WhatsApp rompe
con sus cambios). El criterio de éxito de la incidencia 1 («id presente») se apoyaba en ese
valor de retorno, así que cada entrega real volvió a computar como fallo. La diferencia: el
tope de 3 cortó la hemorragia en 3 mensajes en vez de infinitos.

Nota: la verificación por ack del código antiguo también buscaba el mensaje en el chat, pero lo
buscaba **por id** — que era `undefined` — por lo que nunca lo encontraba.

### Arreglo aplicado (commit `65f8e16`, 18 jul — **desplegado pero sin estrenar con un aviso real**)
**Verificación de entrega contra la realidad, no contra la librería:** tras `sendMessage`
(devuelva lo que devuelva, incluso si lanza excepción), el script lee los últimos 10 mensajes
del chat y busca uno **enviado por nosotros con el texto exacto** del aviso (hasta 6 intentos,
1,5 s entre ellos). Si está en el chat, es éxito; si no, fallo. El id y el ack quedan como
metadatos informativos.

### Estado del aviso afectado
El aviso de tormentas del 19 jul está en `alert_send_attempts` con 3 intentos (agotado,
persistido en BD): **no se reenviará** aunque se despliegue de nuevo. Los grupos lo recibieron
(tres veces).

---

## Estado actual (18 jul, tras la incidencia 2)

- **Magic Container: des-deployado por el usuario.** Sin portal, sin gráfica de viento, sin
  monitorización y sin ninguna vía de alertas mientras siga parado.
- Todos los arreglos están en `main` (`65f8e16` es el último). El fix de verificación por chat
  **no se ha probado aún con un envío real**.
- BD (persistente, no afectada por el undeploy): 2 despachos correctos registrados (9 y 14 jul),
  1 aviso agotado (18 jul).
- La sesión de WhatsApp vinculada el día 9 seguía operativa en la incidencia 2 (los mensajes
  salían); el último backup bueno de sesión es del 14 jul.

## Defensas acumuladas en el pipeline

| Defensa | Origen |
|---|---|
| Watchdogs a todos los niveles + kill al árbol de procesos completo | Incidencia 7–9 jul |
| Exit inmediato si la sesión pide QR o falla auth | Incidencia 7–9 jul |
| Backup/restore de sesión con verificación de integridad en ambos sentidos | Incidencia 7–9 jul |
| Envíos serializados (mutex) y sesión local persistente entre intentos | Incidencia 7–9 jul |
| Dedup por fingerprint estable (zona+fenómeno+nivel+onset) en BD | Rediseño 6 jul |
| Ack solo informativo (nunca criterio de éxito) | Incidencia 15 jul |
| Tope duro: máx. 3 envíos por aviso, persistido en BD | Incidencia 15 jul |
| Verificación de entrega leyendo el chat (independiente de la librería) | Incidencia 18 jul |
| Telemetría: `/api/aemet/dry-run` y check `alert_dispatch` en `/api/status` | Rediseño 9 jul |

**Garantía combinada actual:** un aviso no puede generar ni silencio indefinido sin rastro
(telemetría + errores visibles) ni más de 3 mensajes (tope en BD), pase lo que pase con la librería.

## Riesgo estructural y decisión pendiente

whatsapp-web.js es scraping no oficial de WhatsApp Web: **cada cambio de WhatsApp puede romperlo
de una forma nueva** (las tres incidencias son variantes de esto). Los candados acotan el daño,
pero no eliminan la fragilidad de origen.

Opciones sobre la mesa (pendiente de decisión del usuario):

1. **Redesplegar con envío automático apagado** (`WA_AUTO_SEND_ENABLED=false` en el panel del MC):
   portal y monitorización operativos hoy, riesgo de spam cero, alertas visibles solo en portal/dry-run.
2. **Redesplegar con todo activo:** el próximo aviso estrena la verificación por chat.
   Peor caso teórico si surge otro bug distinto: 3 duplicados y parada automática.
3. **Migrar alertas a la API oficial de Meta** (token permanente ya operativo): infrangible por
   diseño, pero la API oficial **no envía a grupos** — sería plantilla aprobada a la lista de
   números individuales de la junta.

## Referencias

- Commits (repo `martincox-dev/cvb-app-meteo-ui`, rama `main`):
  `3bff76b` (idempotencia + tope 3), `65f8e16` (verificación por chat), y serie del 7–9 jul
  (`653ef5d` … `608658e`).
- Endpoints de diagnóstico: `GET /api/aemet/dry-run`, `GET /api/status` (check `alert_dispatch`),
  `POST /api/whatsapp/wa-test`, `POST /api/whatsapp/start-qr` + `GET /api/whatsapp/qr`.
- Tablas BD (BunnyDB/libSQL): `alert_dispatches` (envíos correctos), `alert_send_attempts`
  (contador de intentos por fingerprint).
- Deploy/undeploy/restart del MC por API: ver `App meteo/ACCESOS.md`.
- Tests: `npm test` (14 tests del pipeline AEMET con fixtures CAP reales).
