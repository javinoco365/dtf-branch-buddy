import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { numero } from "@/lib/format";
import { Explicacion } from "@/components/Explicacion";
import { DEFINICIONES, type ClaveDefinicion } from "@/dominio/definiciones";

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
}: {
  titulo: string;
  /** La definición que sale en su ⓘ (ver dominio/definiciones.ts). */
  explicacion?: ClaveDefinicion;
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
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>{titulo}</span>
            {explicacion && <Explicacion titulo={titulo} definicion={DEFINICIONES[explicacion]} />}
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className={`mt-3 text-3xl font-bold tracking-tight ${valorColor}`}>{valor}</div>
        <LineaVariacion delta={delta} frente={frente} inverso={deltaInverso} />
      </CardContent>
    </Card>
  );
}

/**
 * «↗ 12,4 % frente a septiembre 2026», en verde si es buena noticia y en rojo
 * si no. Sin `frente` no se pinta: la pantalla no está comparando.
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
  if (!frente) return null;
  if (delta === null) {
    return <div className="mt-1 text-xs text-muted-foreground">Sin datos en {frente}</div>;
  }
  const subiendo = delta >= 0;
  const positivo = inverso ? !subiendo : subiendo;
  return (
    <div
      className={`mt-1 flex items-center gap-1 text-xs font-medium ${
        positivo ? "text-status-completado" : "text-status-cancelado"
      }`}
    >
      {subiendo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {numero(Math.abs(delta), 1)}% frente a {frente}
    </div>
  );
}
