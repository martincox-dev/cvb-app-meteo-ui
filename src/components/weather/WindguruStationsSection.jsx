import WindguruWidget from "./WindguruWidget";

const STATIONS = [
  { id: "1305", title: "Playa Gurugú - Club Eolo (1305)" },
  { id: "2706", title: "Oropesa - Club Náutic (2706)" },
];

export default function WindguruStationsSection() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Windguru Estaciones</h2>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {STATIONS.map((station) => (
          <WindguruWidget key={station.id} stationId={station.id} title={station.title} />
        ))}
      </div>
    </section>
  );
}
