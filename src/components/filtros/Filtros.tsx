import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
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
