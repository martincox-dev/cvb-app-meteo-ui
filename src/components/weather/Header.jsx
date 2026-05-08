import { Wind, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function Header({ lastUpdate }) {
  const now = new Date();

  return (
    <header className="bg-white border-b border-border shadow-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Club name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-sm overflow-hidden">
              <img
                src="https://media.base44.com/images/public/69fdcf37fbe3119a19af55e5/5fc0277b6_marineria_delante.svg"
                alt="CVB Logo"
                className="w-8 h-8 object-contain brightness-0 invert"
              />
            </div>
            <div>
              <h1 className="font-space font-700 text-foreground text-base leading-tight font-bold">
                Club de Vela Benicàssim
              </h1>
              <p className="text-xs text-muted-foreground">Portal Meteorológico</p>
            </div>
          </div>

          {/* Live indicator + time */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>
                Actualizado: {format(now, "HH:mm", { locale: es })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-success/10 text-success px-3 py-1.5 rounded-full text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-slow inline-block" />
              EN DIRECTO
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}