// Mock data for Club de Vela Benicàssim weather portal

export const stationData = {
  name: "Estación CVB - Puerto Benicàssim",
  lastUpdate: new Date().toISOString(),
  current: {
    windSpeed: 14.2,       // nudos
    windGust: 19.8,        // nudos
    windDir: 218,          // grados (SSW)
    windDirText: "SSO",
    temp: 22.4,            // ºC
    humidity: 68,          // %
    pressure: 1016.2,      // hPa
    seaTemp: 19.8,         // ºC
    waveHeight: 0.4,       // metros
    visibility: "Buena",
    cloudCover: 35,        // %
  },
  hourly: [
    { time: "08:00", wind: 8,  gust: 12, dir: 195 },
    { time: "09:00", wind: 10, gust: 14, dir: 200 },
    { time: "10:00", wind: 11, gust: 15, dir: 208 },
    { time: "11:00", wind: 13, gust: 17, dir: 215 },
    { time: "12:00", wind: 14, gust: 19, dir: 218 },
    { time: "13:00", wind: 16, gust: 22, dir: 220 },
    { time: "14:00", wind: 18, gust: 24, dir: 225 },
    { time: "15:00", wind: 17, gust: 23, dir: 222 },
    { time: "16:00", wind: 15, gust: 20, dir: 218 },
    { time: "17:00", wind: 13, gust: 18, dir: 215 },
    { time: "18:00", wind: 11, gust: 15, dir: 210 },
    { time: "19:00", wind: 9,  gust: 13, dir: 205 },
  ],
  forecast: [
    { day: "Hoy",      icon: "partly-cloudy", maxWind: 20, minWind: 8,  dir: "SSO", waveH: 0.4, seaState: "Marejadilla" },
    { day: "Sábado",   icon: "sunny",         maxWind: 16, minWind: 6,  dir: "ESE", waveH: 0.3, seaState: "Rizada" },
    { day: "Domingo",  icon: "cloudy",        maxWind: 24, minWind: 12, dir: "SSO", waveH: 0.7, seaState: "Marejada" },
    { day: "Lunes",    icon: "rainy",         maxWind: 28, minWind: 15, dir: "SO",  waveH: 1.1, seaState: "Marejada" },
    { day: "Martes",   icon: "sunny",         maxWind: 12, minWind: 4,  dir: "ENE", waveH: 0.2, seaState: "Rizada" },
    { day: "Miércoles",icon: "sunny",         maxWind: 10, minWind: 3,  dir: "E",   waveH: 0.2, seaState: "Llana" },
    { day: "Jueves",   icon: "partly-cloudy", maxWind: 18, minWind: 8,  dir: "SSO", waveH: 0.5, seaState: "Marejadilla" },
  ]
};

export const aemetAlerts = [
  {
    id: "A001",
    level: "amarillo",
    levelLabel: "Aviso Amarillo",
    phenomenon: "Viento",
    area: "Litoral Norte de Castellón",
    description: "Vientos del SO con rachas que pueden superar los 50 km/h en la tarde del sábado. Se recomienda precaución en zonas costeras y embarcaciones menores.",
    validFrom: "2026-05-09T14:00:00",
    validTo: "2026-05-09T22:00:00",
    source: "AEMET",
  },
  {
    id: "A002",
    level: "naranja",
    levelLabel: "Aviso Naranja",
    phenomenon: "Fenómenos Costeros",
    area: "Costa de Castellón",
    description: "Marejada con olas de entre 1.5 y 2 metros previstas para el domingo. Puerto cerrado a embarcaciones de recreo durante el periodo de aviso.",
    validFrom: "2026-05-10T06:00:00",
    validTo: "2026-05-10T20:00:00",
    source: "AEMET",
  },
  {
    id: "A003",
    level: "verde",
    levelLabel: "Sin Avisos Activos",
    phenomenon: "General",
    area: "Litoral Castellón",
    description: "No hay avisos activos para hoy viernes. Condiciones favorables para la navegación de recreo.",
    validFrom: "2026-05-08T00:00:00",
    validTo: "2026-05-08T23:59:00",
    source: "AEMET",
  },
];

export const windyLayers = [
  { id: "wind",     label: "Viento" },
  { id: "waves",    label: "Oleaje" },
  { id: "rain",     label: "Lluvia" },
  { id: "temp",     label: "Temperatura" },
  { id: "pressure", label: "Presión" },
];

// Windguru-style multi-day table data
export const windguruData = {
  updated: new Date().toISOString(),
  model: "GFS 27km",
  rows: [
    {
      date: "Vie 08",
      slots: [
        { hour: "02h", wind: 8,  gust: 11, dir: 185, waves: 0.3, period: 5, temp: 18 },
        { hour: "08h", wind: 10, gust: 14, dir: 200, waves: 0.3, period: 5, temp: 20 },
        { hour: "14h", wind: 16, gust: 21, dir: 218, waves: 0.5, period: 6, temp: 23 },
        { hour: "20h", wind: 12, gust: 16, dir: 215, waves: 0.4, period: 6, temp: 21 },
      ]
    },
    {
      date: "Sáb 09",
      slots: [
        { hour: "02h", wind: 9,  gust: 12, dir: 180, waves: 0.3, period: 5, temp: 18 },
        { hour: "08h", wind: 11, gust: 14, dir: 190, waves: 0.3, period: 5, temp: 20 },
        { hour: "14h", wind: 14, gust: 19, dir: 195, waves: 0.4, period: 6, temp: 23 },
        { hour: "20h", wind: 16, gust: 22, dir: 210, waves: 0.5, period: 6, temp: 21 },
      ]
    },
    {
      date: "Dom 10",
      slots: [
        { hour: "02h", wind: 14, gust: 20, dir: 220, waves: 0.7, period: 7, temp: 17 },
        { hour: "08h", wind: 18, gust: 25, dir: 225, waves: 0.9, period: 7, temp: 18 },
        { hour: "14h", wind: 22, gust: 30, dir: 230, waves: 1.2, period: 8, temp: 20 },
        { hour: "20h", wind: 20, gust: 27, dir: 228, waves: 1.1, period: 8, temp: 18 },
      ]
    },
    {
      date: "Lun 11",
      slots: [
        { hour: "02h", wind: 18, gust: 26, dir: 235, waves: 1.2, period: 8, temp: 17 },
        { hour: "08h", wind: 22, gust: 30, dir: 240, waves: 1.4, period: 9, temp: 17 },
        { hour: "14h", wind: 26, gust: 35, dir: 245, waves: 1.6, period: 9, temp: 18 },
        { hour: "20h", wind: 20, gust: 28, dir: 240, waves: 1.4, period: 9, temp: 17 },
      ]
    },
    {
      date: "Mar 12",
      slots: [
        { hour: "02h", wind: 8,  gust: 11, dir: 80,  waves: 0.5, period: 6, temp: 17 },
        { hour: "08h", wind: 10, gust: 13, dir: 90,  waves: 0.3, period: 6, temp: 18 },
        { hour: "14h", wind: 12, gust: 16, dir: 95,  waves: 0.3, period: 5, temp: 21 },
        { hour: "20h", wind: 8,  gust: 11, dir: 85,  waves: 0.2, period: 5, temp: 19 },
      ]
    },
  ]
};