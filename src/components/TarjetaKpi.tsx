import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { numero, numeroJusto } from "@/lib/format";
import { Explicacion } from "@/components/Explicacion";
import { DEFINICIONES, type ClaveDefinicion, type Definicion } from "@/dominio/definiciones";
import { formaVariacion } from "@/dominio/kpis";

/**
 * Una cifra de un cuadro de mando, con su variación frente al periodo con el
 * que se compara («+12,4 % frente a septiembre 2026»).
 */
export function TarjetaKpi({
  titulo,
  valor,
  delta,
  frente,
  icon: Icon,
  color = "primary",
  deltaInverso = false,
  explicacion,
  pie,
}: {
  titulo: string;
  /** Debajo de todo: un enlace al detalle, una nota. */
  pie?: ReactNode;
  /**
   * La definición que sale en su ⓘ (ver dominio/definiciones.ts): su clave o,
   * si lleva datos del caso, la definición ya montada.
   */
  explicacion?: ClaveDefinicion | Definicion;
  valor: string;
  /** `null` cuando el periodo anterior no da para comparar. */
  delta: number | null;
  /** Con qué se compara («septiembre 2026»); sin él, no se compara. */
  frente?: string;
  icon: LucideIcon;
  color?: "primary" | "destructive";
  deltaInverso?: boolean;
}) {
  const iconBg =
    color === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  const valorColor = color === "destructive" ? "text-destructive" : "text-foreground";

  return (
    <Card>
      {/* En el móvil van dos por fila: más justas y sin el icono, que es
          adorno y les quitaba el sitio a la cifra. */}
      <CardContent className="p-3.5 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-1.5 text-[11px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>{titulo}</span>
            {explicacion && (
              <Explicacion
                titulo={titulo}
                definicion={
                  typeof explicacion === "string" ? DEFINICIONES[explicacion] : explicacion
                }
              />
            )}
          </div>
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 max-md:hidden ${iconBg}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div
          className={`mt-2 md:mt-3 text-xl md:text-3xl font-bold tracking-tight tabular-nums ${valorColor}`}
        >
          {valor}
        </div>
        <LineaVariacion delta={delta} frente={frente} inverso={deltaInverso} />
        {pie && <div className="mt-2 text-xs">{pie}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * «↗ 12,4 % frente a septiembre 2026», en verde si es buena noticia y en rojo
 * si no. Sin `frente` no se pinta: la pantalla no está comparando. Sin datos en
 * el periodo anterior, tampoco: antes decía «Sin datos en…» en cada tarjeta,
 * ocho veces por pantalla, y el ⓘ ya explica con qué se compara. Con una base
 * muy pequeña, en veces («×61») en vez de un porcentaje disparado.
 */
export function LineaVariacion({
  delta,
  frente,
  inverso = false,
}: {
  delta: number | null;
  frente?: string;
  /** Subir es malo (cancelados, por ejemplo). */
  inverso?: boolean;
}) {
  if (!frente || delta === null) return null;
  const subiendo = delta >= 0;
  const positivo = inverso ? !subiendo : subiendo;
  const forma = formaVariacion(delta);
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-x-1 text-xs font-medium ${
        positivo ? "text-status-completado" : "text-status-cancelado"
      }`}
    >
      {subiendo ? (
        <TrendingUp aria-hidden className="h-3 w-3 shrink-0" />
      ) : (
        <TrendingDown aria-hidden className="h-3 w-3 shrink-0" />
      )}
      <span className="whitespace-nowrap">
        {forma.tipo === "veces"
          ? `×${numeroJusto(forma.valor, 1)}`
          : `${subiendo ? "+" : "−"}${numero(forma.valor, 1)}\u00A0%`}
      </span>
      <span className="font-normal text-muted-foreground">frente a {frente}</span>
    </div>
  );
}
