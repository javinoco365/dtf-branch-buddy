import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Sparkles, TrendingUp, Wrench, type LucideIcon } from "lucide-react";
import {
  NOVEDADES,
  TIPOS_NOVEDAD,
  novedadesPorDia,
  type Novedad,
  type TipoNovedad,
} from "@/dominio/novedades";
import { useNovedadesVistas } from "@/hooks/use-novedades";
import { hoyEnMadrid } from "@/hooks/use-agenda";
import { diaLargo, diaRelativo } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EstadoVacio } from "@/components/EstadoVacio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/panel/novedades")({
  head: () => ({ meta: [{ title: "Novedades · DTF Culture" }] }),
  component: Novedades,
});

/** Un color y un icono por tipo, los mismos en el filtro y en cada tarjeta. */
const ESTILO_TIPO: Record<TipoNovedad, { icono: LucideIcon; chip: string; linea: string }> = {
  nuevo: {
    icono: Sparkles,
    chip: "bg-primary/10 text-primary dark:bg-primary/25 dark:text-foreground",
    linea: "bg-primary",
  },
  mejora: {
    icono: TrendingUp,
    chip: "bg-status-procesando/10 text-status-procesando",
    linea: "bg-status-procesando",
  },
  arreglo: {
    icono: Wrench,
    chip: "bg-status-completado/10 text-status-completado",
    linea: "bg-status-completado",
  },
};

type Filtro = TipoNovedad | "todas";

function Novedades() {
  const { vistas, marcarTodas } = useNovedadesVistas();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  // Lo que no se había visto al entrar: se queda marcado como «Sin ver» durante
  // esta visita, aunque ya se haya guardado como visto (y el número del menú
  // se haya ido).
  const [sinVerAlEntrar, setSinVerAlEntrar] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (vistas === null || sinVerAlEntrar !== null) return;
    setSinVerAlEntrar(new Set(NOVEDADES.filter((n) => !vistas.has(n.id)).map((n) => n.id)));
    marcarTodas();
  }, [vistas, sinVerAlEntrar, marcarTodas]);

  const hoy = hoyEnMadrid();
  const dias = useMemo(
    () => novedadesPorDia(NOVEDADES.filter((n) => filtro === "todas" || n.tipo === filtro)),
    [filtro],
  );
  const cuantas = (t: Filtro) =>
    t === "todas" ? NOVEDADES.length : NOVEDADES.filter((n) => n.tipo === t).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Novedades</h1>
        <p className="text-sm text-muted-foreground">
          Lo que ha cambiado en el CRM. Lo más nuevo, arriba.
        </p>
      </div>

      <div
        role="group"
        aria-label="Qué enseñar"
        className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-1"
      >
        {(["todas", ...TIPOS_NOVEDAD.map((t) => t.id)] as Filtro[]).map((t) => {
          const activo = filtro === t;
          const Icono = t === "todas" ? null : ESTILO_TIPO[t].icono;
          const nombre = t === "todas" ? "Todo" : TIPOS_NOVEDAD.find((x) => x.id === t)!.plural;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={activo}
              onClick={() => setFiltro(t)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm transition-colors md:min-h-9",
                activo
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground",
              )}
            >
              {Icono && <Icono className="h-4 w-4" aria-hidden="true" />}
              {nombre}
              <span className="rounded-md bg-border/60 px-1.5 text-[11px] font-semibold tabular-nums">
                {cuantas(t)}
              </span>
            </button>
          );
        })}
      </div>

      {dias.length === 0 ? (
        <EstadoVacio
          icono={Sparkles}
          titulo="Nada de este tipo todavía"
          descripcion="Cuando haya cambios de este tipo, saldrán aquí."
          accion={
            <Button variant="outline" onClick={() => setFiltro("todas")}>
              Ver todo
            </Button>
          }
        />
      ) : (
        <ol className="space-y-6">
          {dias.map(({ fecha, novedades }) => {
            const relativo = diaRelativo(fecha, hoy);
            const cercano = relativo === "Hoy" || relativo === "Ayer";
            return (
              <li key={fecha} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {cercano ? `${relativo} · ` : ""}
                  {diaLargo(fecha)}
                </h2>
                <ul className="space-y-3">
                  {novedades.map((n) => (
                    <TarjetaNovedad key={n.id} novedad={n} sinVer={!!sinVerAlEntrar?.has(n.id)} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TarjetaNovedad({ novedad: n, sinVer }: { novedad: Novedad; sinVer: boolean }) {
  const estilo = ESTILO_TIPO[n.tipo];
  const Icono = estilo.icono;
  const tipo = TIPOS_NOVEDAD.find((t) => t.id === n.tipo)!.nombre;
  return (
    <li>
      <Card className="relative overflow-hidden">
        {/* Una franja del color del tipo: se distingue sin leer. */}
        <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", estilo.linea)} />
        <CardContent className="space-y-2 p-4 pl-5 md:p-5 md:pl-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                estilo.chip,
              )}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden="true" />
              {tipo}
            </span>
            {sinVer && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-procesando">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-status-procesando"
                />
                Sin ver
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold leading-snug">{n.titulo}</h3>
          <p className="text-sm text-secondary-foreground">{n.resumen}</p>
          <ul className="space-y-1">
            {n.puntos.map((p) => (
              <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-status-completado"
                  aria-hidden="true"
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {n.enlace && (
            <Button asChild variant="outline" size="sm" className="mt-1 min-h-11 md:min-h-9">
              <Link to={n.enlace.ruta as never}>
                {n.enlace.texto}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
