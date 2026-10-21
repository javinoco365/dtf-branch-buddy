import { useState, type ReactNode } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTextoDiferido } from "@/lib/filtros-url";
import { cn } from "@/lib/utils";

/**
 * Piezas de las barras de filtros. Los valores vienen de la dirección
 * (useFiltrosUrl); aquí solo se pintan y avisan del cambio.
 */

/** La tarjeta que agrupa los filtros de una lista. */
export function BarraFiltros({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-2">{children}</CardContent>
    </Card>
  );
}

/**
 * Los filtros de una pantalla, plegados en el móvil en una sola línea que dice
 * lo elegido («Octubre 2026 · Tienda Uno»): desplegados se comían un tercio de
 * la primera vista y solo se veía una cifra. En el ordenador (desde 768 px) se
 * ven siempre, como antes.
 */
export function FiltrosPlegables({
  resumen,
  className,
  children,
}: {
  resumen: string;
  className?: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-left text-sm md:hidden"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{resumen}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("h-4 w-4 shrink-0 transition-transform", abierto && "rotate-180")}
        />
      </button>
      <div className={abierto ? "max-md:mt-2" : "max-md:hidden"}>{children}</div>
    </div>
  );
}

/** Cuadro de búsqueda que no reescribe la dirección en cada tecla. */
export function CampoBusqueda({
  valor,
  alCambiar,
  placeholder,
}: {
  valor: string;
  alCambiar: (texto: string) => void;
  placeholder: string;
}) {
  const [texto, setTexto] = useTextoDiferido(valor, alCambiar);
  return (
    <div className="relative flex-1 min-w-[220px]">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="pl-9"
        aria-label={placeholder}
      />
    </div>
  );
}

/** Un desplegable de filtro. La primera opción suele ser «todos». */
export function SelectFiltro({
  valor,
  alCambiar,
  opciones,
  etiqueta,
  ancho = "w-[180px]",
}: {
  valor: string;
  alCambiar: (valor: string) => void;
  opciones: readonly { valor: string; etiqueta: string }[];
  etiqueta: string;
  ancho?: string;
}) {
  return (
    <Select value={valor} onValueChange={alCambiar}>
      <SelectTrigger className={ancho} aria-label={etiqueta}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opciones.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.etiqueta}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** «Quitar filtros», solo cuando hay alguno puesto. */
export function QuitarFiltros({ visible, alQuitar }: { visible: boolean; alQuitar: () => void }) {
  if (!visible) return null;
  return (
    <Button variant="ghost" size="sm" onClick={alQuitar}>
      <X className="h-4 w-4 mr-1" /> Quitar filtros
    </Button>
  );
}
