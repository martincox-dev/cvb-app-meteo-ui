import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Video, AlertCircle, Loader2, ExternalLink, RefreshCw } from "lucide-react";

const STREAM_URL = "https://streaming.comunitatvalenciana.com/webcam/BenicassimVela/manifest.m3u8";

export default function WebcamViewer() {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | playing | error

  function initHls() {
    const video = videoRef.current;
    if (!video) return;

    setStatus("loading");

    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(STREAM_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        setStatus("playing");
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setStatus("error");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = STREAM_URL;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
        setStatus("playing");
      });
      video.addEventListener("error", () => setStatus("error"));
    } else {
      setStatus("error");
    }
  }

  useEffect(() => {
    initHls();
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg flex items-center gap-2">
          <Video className="w-4 h-4 text-primary" />
          Webcam en Directo — Club de Vela Benicàssim
        </h2>
        <div className="flex items-center gap-3">
          {status === "playing" && (
            <div className="flex items-center gap-1.5 bg-destructive/10 text-destructive px-3 py-1.5 rounded-full text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse-slow inline-block" />
              EN DIRECTO
            </div>
          )}
          <a
            href={STREAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
          >
            Stream directo
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        {/* Video container */}
        <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            muted
            playsInline
            controls
          />

          {/* Loading overlay */}
          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Conectando con la cámara...</p>
            </div>
          )}

          {/* Error overlay */}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-4">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <div className="text-center">
                <p className="text-sm font-semibold mb-1">Stream no disponible</p>
                <p className="text-xs text-white/60">La cámara puede estar offline temporalmente</p>
              </div>
              <button
                onClick={initHls}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white text-sm px-4 py-2 rounded-xl transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reintentar
              </button>
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t border-border/50 text-xs text-muted-foreground">
          <span>📍 Webcam Benicasim Vela</span>
          <span>Fuente: Comunitat Valenciana Streaming</span>
        </div>
      </div>
    </section>
  );
}
