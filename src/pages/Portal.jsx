import { useState, useEffect } from "react";
import Header from "../components/weather/Header";
import CurrentConditions from "../components/weather/CurrentConditions";
import HourlyChart from "../components/weather/HourlyChart";
import AemetAlerts from "../components/weather/AemetAlerts";
import AemetHistory from "../components/weather/AemetHistory";
import WindyMap from "../components/weather/WindyMap";
import StationsMap from "../components/weather/StationsMap";
import WebcamViewer from "../components/weather/WebcamViewer";

export default function Portal() {
  const [station, setStation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [aemetHistory, setAemetHistory] = useState([]);
  const [stations, setStations] = useState([]);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/meteo");
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.ok) return;
        if (data.station) setStation(data.station);
        if (Array.isArray(data.aemetAlerts)) setAlerts(data.aemetAlerts);
        if (Array.isArray(data.aemetHistory)) setAemetHistory(data.aemetHistory);
        if (Array.isArray(data.stations)) setStations(data.stations);
        setIsLive(true);
      } catch {
        setIsLive(false);
      }
    };
    load();
    const interval = setInterval(load, 300000);
    return () => clearInterval(interval);
  }, []);

  if (!station) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Cargando datos meteo...</div>
      </div>
    );
  }

  const alertsSource = alerts.length ? alerts : aemetHistory.slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <Header lastUpdate={station.lastUpdate} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">

        {/* Top section: Current + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: current conditions */}
          <div className="lg:col-span-2 space-y-4">
            <CurrentConditions data={station} />
          </div>

          {/* Right: AEMET alerts */}
          <div className="lg:col-span-1">
            <AemetAlerts alerts={alertsSource} />
          </div>
        </div>

        {/* Hourly chart */}
        <HourlyChart hourly={station.hourly} />

        {/* Windy map */}
        <WindyMap />

        {/* Stations map */}
        <StationsMap stations={stations} />

        {/* Webcam */}
        <WebcamViewer />

        {/* AEMET alert history */}
        <AemetHistory alerts={aemetHistory} />

        {/* Footer */}
        <footer className="border-t border-border pt-6 pb-4 text-center">
          <p className="text-xs text-muted-foreground">
            Club de Vela Benicàssim · Portal Meteorológico ·{" "}
            <span className="font-medium">{isLive ? "Datos en vivo" : "Datos de respaldo"}</span>
            {" "}· Fuentes: Windy (ECMWF), AEMET, WindGuru
          </p>
        </footer>
      </main>
    </div>
  );
}
