import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { eur, numero, numeroJusto } from "@/lib/format";
import { Explicacion } from "@/components/Explicacion";
import {
  DEFINICIONES,
  definicionDeConcepto,
  type ClaveDefinicion,
  type Definicion,
} from "@/dominio/definiciones";
import { formaVariacion } from "@/dominio/kpis";
import { concepto, variacionCifra, type Cifra, type ClaveConcepto } from "@/dominio/cuenta";

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
 * Una cifra de la cuenta de resultados (dominio/cuenta.ts) en una tarjeta:
 * con el nombre y la ⓘ del diccionario, «—» y el motivo si no se puede saber,
 * y la marca «Estimado» con lo que se ha supuesto. El mismo nombre y la misma
 * cuenta en todas las pantallas.
 */
export function TarjetaConcepto({
  clave,
  cifra,
  previa,
  frente,
  icon,
  pie,
}: {
  clave: ClaveConcepto;
  /** Nula mientras se lee. */
  cifra: Cifra | null;
  /** La del periodo con el que se compara. */
  previa?: Cifra | null;
  frente?: string;
  icon: LucideIcon;
  /** Debajo, tras el motivo o la marca de estimado. */
  pie?: ReactNode;
}) {
  const c = concepto(clave);
  const valor = cifra?.valor ?? null;
  const delta = cifra ? variacionCifra(cifra, previa ?? undefined) : null;
  // Que caiga lo que se debe es buena noticia.
  const inverso = clave === "pendiente_cobro" || clave === "pendiente_pago";
  return (
    <TarjetaKpi
      titulo={c.nombre}
      explicacion={definicionDeConcepto(clave)}
      valor={cifra === null ? "…" : valor === null ? "—" : eur(valor)}
      delta={frente ? delta : null}
      frente={frente}
      deltaInverso={inverso}
      icon={icon}
      color={valor !== null && valor < 0 && c.destacado ? "destructive" : "primary"}
      pie={
        cifra?.falta || cifra?.estimado || pie ? (
          <span className="flex flex-col gap-0.5">
            {cifra?.falta && <span className="text-muted-foreground">{cifra.falta}</span>}
            {cifra?.estimado && <MarcaEstimado nota={cifra.nota} />}
            {pie}
          </span>
        ) : undefined
      }
    />
  );
}

/** «Estimado», con lo que se ha supuesto al lado. */
export function MarcaEstimado({ nota }: { nota?: string }) {
  return (
    <span className="text-status-pendiente">
      <span className="font-medium">Estimado</span>
      {nota ? <span className="text-muted-foreground"> · {nota}</span> : null}
    </span>
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
