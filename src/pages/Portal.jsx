import { useState, useEffect } from "react";
import Header from "../components/weather/Header";
import CurrentConditions from "../components/weather/CurrentConditions";
import HourlyChart from "../components/weather/HourlyChart";
import ForecastStrip from "../components/weather/ForecastStrip";
import AemetAlerts from "../components/weather/AemetAlerts";
import AemetHistory from "../components/weather/AemetHistory";
import WindguruTable from "../components/weather/WindguruTable";
import WindyMap from "../components/weather/WindyMap";
import StationsMap from "../components/weather/StationsMap";
import WebcamViewer from "../components/weather/WebcamViewer";
import { stationData, aemetAlerts, windguruData } from "../lib/mockData";

export default function Portal() {
  const [station, setStation] = useState(stationData);
  const [alerts, setAlerts] = useState(aemetAlerts);
  const [guruTable, setGuruTable] = useState(windguruData);
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
        if (data.windguruData) setGuruTable(data.windguruData);
        setIsLive(true);
      } catch {
        setIsLive(false);
      }
    };
    load();
    const interval = setInterval(load, 300000);
    return () => clearInterval(interval);
  }, []);

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
            <AemetAlerts alerts={alerts} />
          </div>
        </div>

        {/* Hourly chart */}
        <HourlyChart hourly={station.hourly} />

        {/* 7-day forecast */}
        <ForecastStrip forecast={station.forecast} />

        {/* Windy map */}
        <WindyMap />

        {/* Stations map */}
        <StationsMap />

        {/* Webcam */}
        <WebcamViewer />

        {/* AEMET alert history */}
        <AemetHistory />

        {/* Windguru table */}
        <WindguruTable data={guruTable} />

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
