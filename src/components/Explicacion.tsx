import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Definicion } from "@/dominio/definiciones";

/**
 * El ⓘ de una cifra: qué es, cómo se calcula y de dónde sale.
 *
 * En el ordenador se abre al pasar el ratón; en el móvil, donde no hay ratón,
 * al tocarlo. Es un Popover y no un Tooltip porque el Tooltip no se abre con
 * el dedo.
 */
export function Explicacion({ titulo, definicion }: { titulo: string; definicion: Definicion }) {
  const [abierta, setAbierta] = useState(false);
  const conRaton = (e: React.PointerEvent) => e.pointerType === "mouse";

  return (
    <Popover open={abierta} onOpenChange={setAbierta}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Qué es «${titulo}»`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerEnter={(e) => conRaton(e) && setAbierta(true)}
          onPointerLeave={(e) => conRaton(e) && setAbierta(false)}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-72 space-y-2 text-xs leading-relaxed"
        // Que el ratón pueda pasar del icono al texto sin que se cierre.
        onPointerEnter={(e) => conRaton(e) && setAbierta(true)}
        onPointerLeave={(e) => conRaton(e) && setAbierta(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p>{definicion.que}</p>
        <p>
          <span className="font-medium text-foreground">Cálculo: </span>
          {definicion.calculo}
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium">Datos: </span>
          {definicion.fuente}
        </p>
      </PopoverContent>
    </Popover>
  );
}
