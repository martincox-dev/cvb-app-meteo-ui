# Fuentes Meteo en Producción (CVB)

## 1) Cabecera "Condiciones Actuales" (estación CVB hipotética)

La cabecera ya no usa Bartolo como estación principal.

Se calcula una **estación CVB interpolada** con estas dos estaciones satélite AVAMET:

- `c05m028e05` Benicàssim - Hotel Voramar
- `c05m028e09` Benicàssim - Platja d'Heliòpolis

Variables interpoladas:

- Viento medio (`vent`) -> nudos
- Racha (`vent_max`) -> nudos
- Dirección (`vent_dir`)
- Temperatura (`temp`)
- Humedad (`hrel`)
- Presión (`pres`)

## 2) Mar / Ola / Visibilidad

Para mantener coherencia operativa con criterio oficial:

- Fuente: **predicción marítima oficial AEMET** (costa Valencia y Murcia, bloque "Aguas costeras de Castellón")
- URL oficial usada:  
  `https://www.aemet.es/es/eltiempo/prediccion/maritima?area=val1&opc1=0&opc3=1`

Reglas:

- Altura de ola: se extrae del texto oficial (rango en metros).
- Visibilidad: se extrae del texto oficial (muy buena, buena, regular, mala...).
- Temperatura del mar: AEMET texto marítimo costero no publica un valor numérico fijo por zona; se muestra `N/D`.

## 3) Mapa de estaciones

El mapa muestra estaciones **AVAMET** con coordenadas exactas en Benicàssim y alrededores.

- Centro de referencia: coordenadas CVB
- Filtro espacial: radio configurable por `AVAMET_AROUND_RADIUS_KM` (por defecto 20 km)

## 4) Variables de entorno relevantes

- `AEMET_API_KEY`
- `AVAMET_AROUND_RADIUS_KM` (opcional, default `20`)
