import WindguruWidget from "./WindguruWidget";

export default function WindguruStationsSection() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Windguru Previsión</h2>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <WindguruWidget title="Widget oficial Windguru (spot 853188)" />
      </div>
    </section>
  );
}
