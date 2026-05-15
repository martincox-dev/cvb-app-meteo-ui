import { useEffect, useMemo, useRef } from "react";

export default function WindguruWidget({ title }) {
  const mountRef = useRef(null);
  const uid = useMemo(() => `wg_fwdg_503203_52_${Date.now()}`, []);
  const baseUrl = "https://www.windguru.cz/853188";

  useEffect(() => {
    if (!mountRef.current) return;
    mountRef.current.innerHTML = "";

    const arg = [
      "s=503203",
      "m=52",
      "mw=46",
      `uid=${uid}`,
      "ai=0",
      "wj=knots",
      "tj=c",
      "waj=m",
      "tij=cm",
      "odh=0",
      "doh=24",
      "fhours=240",
      "hrsm=2",
      "vt=forecasts",
      "lng=en",
      "p=WINDSPD,GUST,SMER,HTSGW,PERPW,DIRPW,SWELL1,SWPER1,SWDIR1,TMP,CDC,APCP1s,RH",
    ];

    const script = document.createElement("script");
    script.src = `https://www.windguru.cz/js/widget.php?${arg.join("&")}`;
    script.async = true;
    mountRef.current.appendChild(script);
  }, [uid]);

  return (
    <article className="bg-white rounded-xl border border-border/60 shadow-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
        >
          Abrir Windguru
        </a>
      </header>
      <div className="px-4 py-5 bg-muted/20">
        <div ref={mountRef} id={uid} />
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex mt-3 text-sm text-primary hover:underline font-medium"
        >
          Abrir Windguru
        </a>
      </div>
    </article>
  );
}
