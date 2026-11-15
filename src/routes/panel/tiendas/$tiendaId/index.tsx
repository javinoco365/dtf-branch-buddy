import { createFileRoute } from "@tanstack/react-router";
import { faltaLaColumna, tabla } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { metros, numero } from "@/lib/format";
import { useCuentaResultados } from "@/lib/cuenta";
import { ETIQUETA_FILTRO_LINEA } from "@/dominio/por-linea";
import { ESTADO_CANCELADO, variacion } from "@/dominio/kpis";
import { documentosVigentes, type DocumentoFacturado } from "@/dominio/cuenta";
import { leerTodas } from "@/lib/paginar";
import { useLineaUrl } from "@/lib/filtros-url";
import { SelectorLinea } from "@/components/filtros/SelectorLinea";
import { compararCon, rangoDe } from "@/dominio/periodos";
import { TarjetaDato, TarjetaKpi } from "@/components/TarjetaKpi";
import { CifrasDelPeriodo } from "@/components/CifrasDelPeriodo";
import { ErrorCarga } from "@/components/ErrorCarga";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";
import { ICONOS_PANTALLA } from "@/components/iconos";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/")({
  component: Dashboard,
});

/** Los totales de la tienda desde el principio: pedidos, metros y documentos. */
function useTotalesTienda(tiendaId: string) {
  return useQuery({
    queryKey: ["tienda-dashboard", tiendaId],
    queryFn: async () => {
      // Todos, por páginas: antes se leía de una vez y Supabase corta en
      // 1000 filas sin avisar. Sin los cancelados, que no son venta.
      // metros_uv viene de 20261110100000: sin ella, se lee como antes.
      const leerPedidos = async () => {
        const leer = (columnas: string) =>
          leerTodas<{ metros_total: number | null; metros_uv?: number | null }>((a, b) =>
            tabla(supabase, "pedidos")
              .select(columnas)
              .eq("tienda_id", tiendaId)
              .neq("estado", ESTADO_CANCELADO)
              .order("id")
              .range(a, b),
          );
        const r = await leer("id, metros_total, metros_uv");
        if (!faltaLaColumna(r.error)) return r;
        return leer("id, metros_total");
      };
      // Las facturas y tickets, para contar solo los vigentes: sin borradores
      // ni anuladas, y un ticket canjeado por factura una sola vez.
      // sustituye_a_id viene de 20261004100100: sin ella, sin canjes.
      const leerDocumentos = async () => {
        const leer = (columnas: string) =>
          leerTodas<DocumentoFacturado>((a, b) =>
            tabla(supabase, "facturas")
              .select(columnas)
              .eq("tienda_id", tiendaId)
              .order("id")
              .range(a, b),
          );
        const r = await leer("id, estado, sustituye_a_id");
        if (!faltaLaColumna(r.error)) return r;
        return leer("id, estado");
      };
      const [pedidos, documentos] = await Promise.all([leerPedidos(), leerDocumentos()]);
      if (pedidos.error) throw new Error(pedidos.error.message);
      if (documentos.error) throw new Error(documentos.error.message);
      const filas = (pedidos.data ?? []) as {
        metros_total: number | null;
        metros_uv?: number | null;
      }[];
      return {
        pedidos: filas.length,
        // Los metros de cada línea, por separado: no se suman entre sí.
        metros: filas.reduce((s, p) => s + Number(p.metros_total ?? 0), 0),
        metrosUv: filas.reduce((s, p) => s + Number(p.metros_uv ?? 0), 0),
        documentos: documentosVigentes(documentos.data ?? []).length,
      };
    },
  });
}

function Dashboard() {
  const { tiendaId } = Route.useParams();
  const { data: tiendas } = useTiendasMenu();
  const nombreTienda = tiendas?.find((t) => t.id === tiendaId)?.nombre;
  const totales = useTotalesTienda(tiendaId);

  // El mes en curso con la cuenta de resultados (cuenta.ts) y comparado con
  // el mismo trozo del mes anterior: el día 5, contra del 1 al 5 del mes pasado.
  const hoy = useMemo(() => new Date(), []);
  const mes = useMemo(() => rangoDe({ tipo: "mes", ref: hoy })!, [hoy]);
  const comparacion = useMemo(
    () => compararCon({ tipo: "mes", ref: hoy }, "anterior", hoy)!,
    [hoy],
  );
  // La línea de producto (por-linea.ts): las dos, DTF o DTF UV.
  const [linea, cambiarLinea] = useLineaUrl();
  const filtro = useMemo(() => ({ tienda: tiendaId, linea }), [tiendaId, linea]);
  const lectura = useCuentaResultados({
    rango: mes,
    previo: comparacion.previo,
    filtro,
    soloTienda: true,
    gastos: false,
  });
  const { cuenta, previa } = lectura;
  const frente = comparacion.etiqueta;
  const deTotal = (n: number | undefined, formato: (n: number) => string) =>
    n === undefined ? "…" : formato(n);

  return (
    <div className="space-y-6">
      <CabeceraPantalla
        tienda={nombreTienda}
        subtitulo={
          <>
            El mes en curso, sin IVA salvo lo cobrado y lo que está por cobrar, frente al mismo
            trozo del mes anterior; y los totales de la tienda.
            {linea !== "todo"
              ? ` El mes en curso, solo ${ETIQUETA_FILTRO_LINEA[linea]}; los totales, de toda la tienda.`
              : ""}
          </>
        }
      >
        <SelectorLinea valor={linea} alCambiar={cambiarLinea} className="mt-2" />
      </CabeceraPantalla>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Este mes</h2>
        {lectura.error ? (
          <ErrorCarga
            error={lectura.error}
            onReintentar={lectura.reintentar}
            reintentando={lectura.reintentando}
            que="las cifras del mes"
          />
        ) : (
          <>
            <CifrasDelPeriodo
              lectura={lectura}
              frente={frente}
              pieVentas={
                cuenta ? (
                  <span className="text-muted-foreground">
                    {numero(cuenta.pedidos, 0)} {cuenta.pedidos === 1 ? "pedido" : "pedidos"}
                  </span>
                ) : undefined
              }
              piePendiente="Hoy, sea del mes que sea"
            />
            <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
              {linea !== "uv" && (
                <TarjetaDato
                  clave="metros"
                  valor={cuenta ? metros(cuenta.metros) : "…"}
                  frente={frente}
                  delta={cuenta && previa ? variacion(cuenta.metros, previa.metros) : null}
                />
              )}
              {(linea === "uv" || (cuenta?.metrosUv ?? 0) > 0) && (
                <TarjetaDato
                  clave="metros_uv"
                  valor={cuenta ? metros(cuenta.metrosUv) : "…"}
                  frente={frente}
                  delta={cuenta && previa ? variacion(cuenta.metrosUv, previa.metrosUv) : null}
                />
              )}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Desde el principio</h2>
        {totales.error ? (
          <ErrorCarga
            error={totales.error}
            onReintentar={totales.refetch}
            reintentando={totales.isRefetching}
            que="los totales de la tienda"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            <TarjetaDato
              clave="pedidos"
              valor={deTotal(totales.data?.pedidos, (n) => numero(n, 0))}
            />
            <TarjetaDato
              clave="metros"
              valor={deTotal(totales.data?.metros, metros)}
              pie={
                (totales.data?.metrosUv ?? 0) > 0 ? (
                  <span className="text-muted-foreground">
                    Aparte,{" "}
                    <span className="font-medium text-linea-uv-texto">
                      {metros(totales.data?.metrosUv)} de DTF UV
                    </span>
                  </span>
                ) : undefined
              }
            />
            <TarjetaKpi
              titulo="Facturas y tickets"
              valor={deTotal(totales.data?.documentos, (n) => numero(n, 0))}
              delta={null}
              icon={ICONOS_PANTALLA.facturas}
              pie={
                <span className="text-muted-foreground">
                  Vigentes: sin borradores ni anuladas, y un ticket canjeado por factura, una vez
                </span>
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
