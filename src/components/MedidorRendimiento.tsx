import { useEffect, useMemo, useReducer, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { numero } from "@/lib/format";
import { crearMedidor, medicionActiva } from "@/lib/medidor";
import { toast } from "sonner";

/**
 * Recuadro de medición (fase 0 del plan de rendimiento). Solo se monta con
 * `?medir=1`; sin eso no hace nada ni se suscribe a nada.
 */
export function MedidorRendimiento() {
  const [activo] = useState(medicionActiva);
  if (!activo) return null;
  return <Recuadro />;
}

/** Tras este tiempo desde el clic, una recarga en segundo plano ya no es «la pantalla». */
const VENTANA_MS = 30_000;

function Recuadro() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, repintar] = useReducer((n: number) => n + 1, 0);
  const [plegado, setPlegado] = useState(false);
  const medidor = useMemo(() => crearMedidor(repintar), []);

  useEffect(() => {
    let fotograma = 0;
    const comprobarLista = () => {
      cancelAnimationFrame(fotograma);
      fotograma = requestAnimationFrame(() => {
        const p = medidor.actual();
        if (!p || globalThis.performance.now() - p.inicio > VENTANA_MS) return;
        if (queryClient.isFetching() === 0) medidor.pantallaLista();
      });
    };

    medidor.navegacionEmpieza(router.state.location.pathname);
    const quitarAntes = router.subscribe("onBeforeNavigate", (e) => {
      medidor.navegacionEmpieza(e.toLocation.pathname);
    });
    const quitarResuelta = router.subscribe("onResolved", (e) => {
      medidor.navegacionResuelta(e.toLocation.pathname);
      comprobarLista();
    });
    if (router.state.status === "idle") {
      medidor.navegacionResuelta(router.state.location.pathname);
      comprobarLista();
    }

    const quitarCache = queryClient.getQueryCache().subscribe((evento) => {
      if (evento.type !== "updated") return;
      const nombre = String(evento.query.queryKey[0]);
      const a = evento.action;
      if (a.type === "fetch") medidor.consultaEmpieza(evento.query.queryHash);
      else if (a.type === "success")
        medidor.consultaTermina(evento.query.queryHash, nombre, a.data, false);
      else if (a.type === "error")
        medidor.consultaTermina(evento.query.queryHash, nombre, undefined, true);
      else return;
      comprobarLista();
    });

    return () => {
      cancelAnimationFrame(fotograma);
      quitarAntes();
      quitarResuelta();
      quitarCache();
    };
  }, [router, queryClient, medidor]);

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${que} copiado al portapapeles`);
    } catch {
      toast.error("No se pudo copiar al portapapeles");
    }
  };

  const copiarMedidas = () => copiar(JSON.stringify(medidor.exportar(), null, 2), "Medidas");

  // Las respuestas de las consultas en caché, ordenadas por clave: sirve para
  // comparar con `diff` que un cambio de rendimiento no altera ningún dato.
  const copiarDatos = () => {
    const datos = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.status === "success")
      .map((q) => ({ clave: q.queryHash, datos: q.state.data }))
      .sort((a, b) => a.clave.localeCompare(b.clave));
    return copiar(JSON.stringify(datos, null, 2), "Datos");
  };

  const p = medidor.actual();
  const consultas = p ? Object.entries(p.consultas).sort((a, b) => b[1].ms - a[1].ms) : [];

  return (
    <div className="fixed bottom-2 right-2 z-[100] w-[min(26rem,calc(100vw-1rem))] rounded-md border bg-card text-card-foreground shadow-lg text-xs">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1">
        <span className="font-medium truncate">Medición · {p?.ruta ?? "—"}</span>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={copiarMedidas}>
            Copiar
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={copiarDatos}>
            Copiar datos
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setPlegado((v) => !v)}
          >
            {plegado ? "Abrir" : "Plegar"}
          </Button>
        </div>
      </div>
      {!plegado && p && (
        <div className="max-h-72 overflow-auto px-2 py-1 space-y-1">
          <div className="grid grid-cols-2 gap-x-2">
            <span>Ruta resuelta</span>
            <span className="text-right tabular-nums">
              {p.msResuelta == null ? "…" : `${numero(p.msResuelta, 0)} ms`}
            </span>
            <span>Pantalla lista</span>
            <span className="text-right tabular-nums">
              {p.msLista == null ? "…" : `${numero(p.msLista, 0)} ms`}
            </span>
            <span>Peticiones (Supabase / serverFn)</span>
            <span className="text-right tabular-nums">
              {p.red.peticiones} ({p.red.supabase} / {p.red.serverFn})
            </span>
            <span>Transferido</span>
            <span className="text-right tabular-nums">{numero(p.red.kb, 1)} KB</span>
            <span>auth/v1/user</span>
            <span className="text-right tabular-nums">{p.red.authUser}</span>
          </div>
          {consultas.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-normal">Consulta</th>
                  <th className="text-right font-normal">Nº</th>
                  <th className="text-right font-normal">ms</th>
                  <th className="text-right font-normal">Filas</th>
                </tr>
              </thead>
              <tbody>
                {consultas.map(([nombre, m]) => (
                  <tr key={nombre}>
                    <td className="truncate max-w-[12rem]">
                      {nombre}
                      {m.errores > 0 ? ` (${m.errores} err.)` : ""}
                    </td>
                    <td className="text-right tabular-nums">{m.peticiones}</td>
                    <td className="text-right tabular-nums">{numero(m.ms, 0)}</td>
                    <td className="text-right tabular-nums">{m.filas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
