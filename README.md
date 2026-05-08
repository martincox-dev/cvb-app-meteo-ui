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
