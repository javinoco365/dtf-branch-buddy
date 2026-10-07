import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PeriodoUrl } from "@/lib/filtros-url";
import { leerFecha } from "@/dominio/filtros";
import {
  esComparar,
  esNavegable,
  esTipoPeriodo,
  etiquetaPeriodo,
  moverSeleccion,
  OPCIONES_COMPARAR,
  rangoDe,
  TIPOS_PERIODO,
  type TipoPeriodo,
} from "@/dominio/periodos";

/**
 * El selector de periodo de todas las pantallas: tipo de periodo, flechas
 * para ir al anterior o al siguiente, «Hoy» para volver al actual y, si la
 * pantalla compara, con qué.
 *
 * `tipos` limita lo que se ofrece (una lista larga de pedidos no debe ofrecer
 * «todo», por ejemplo). Con «Fechas libres», en vez de las flechas salen dos
 * campos de fecha.
 */
export function SelectorPeriodo({
  periodo,
  tipos,
  conComparar = false,
  className,
}: {
  periodo: PeriodoUrl;
  tipos?: readonly TipoPeriodo[];
  conComparar?: boolean;
  className?: string;
}) {
  const { seleccion: sel, elegir, comparar, setComparar } = periodo;
  const opciones = TIPOS_PERIODO.filter((t) => !tipos || tipos.includes(t.valor));
  const rango = rangoDe(sel);
  const dia = (d: Date) => format(d, "yyyy-MM-dd");

  function cambiarTipo(valor: string) {
    if (!esTipoPeriodo(valor)) return;
    if (valor === "libre") {
      // Fechas libres arranca con lo que se estaba viendo, para ajustarlo.
      const r = rango ?? rangoDe({ tipo: "mes", ref: new Date() })!;
      elegir({ tipo: "libre", ref: sel.ref, desde: r.desde, hasta: r.hasta });
      return;
    }
    // Se conserva el día de referencia: de «octubre» a «trimestre» sale el
    // trimestre de octubre, no el actual.
    elegir({ tipo: valor, ref: sel.ref });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select value={sel.tipo} onValueChange={cambiarTipo}>
        <SelectTrigger className="w-[150px] max-md:w-[calc(50%-0.25rem)]" aria-label="Periodo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map((t) => (
            <SelectItem key={t.valor} value={t.valor}>
              {t.etiqueta}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {sel.tipo === "libre" && rango ? (
        <div className="inline-flex items-center gap-1 max-md:w-full">
          <Input
            type="date"
            aria-label="Desde"
            className="w-[150px] max-md:flex-1"
            value={dia(rango.desde)}
            onChange={(e) =>
              e.target.value &&
              elegir({ ...sel, desde: leerFecha(e.target.value), hasta: rango.hasta })
            }
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="Hasta"
            className="w-[150px] max-md:flex-1"
            value={dia(rango.hasta)}
            onChange={(e) =>
              e.target.value &&
              elegir({ ...sel, desde: rango.desde, hasta: leerFecha(e.target.value) })
            }
          />
        </div>
      ) : (
        esNavegable(sel.tipo) && (
          <div className="inline-flex items-center gap-1 max-md:w-full">
            <Button
              variant="outline"
              size="icon"
              aria-label="Periodo anterior"
              onClick={() => elegir(moverSeleccion(sel, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[170px] text-center text-sm font-medium max-md:min-w-0 max-md:flex-1">
              {etiquetaPeriodo(sel)}
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Periodo siguiente"
              onClick={() => elegir(moverSeleccion(sel, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => elegir({ tipo: sel.tipo, ref: new Date() })}
            >
              Hoy
            </Button>
          </div>
        )
      )}

      {conComparar && sel.tipo !== "todo" && (
        <Select value={comparar} onValueChange={(c) => esComparar(c) && setComparar(c)}>
          <SelectTrigger className="w-[210px] max-md:w-full" aria-label="Comparar con">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_COMPARAR.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.etiqueta}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
