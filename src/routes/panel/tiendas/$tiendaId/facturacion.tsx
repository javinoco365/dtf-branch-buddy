import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { usePeriodoUrl } from "@/lib/filtros-url";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVacio } from "@/components/EstadoVacio";
import { eur, metros, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { AvisoActualizando } from "@/components/AvisoActualizando";
import { propsDatosDeAntes } from "@/lib/datos-de-antes";
import {
  useCobrosPeriodo,
  useLineasPeriodo,
  usePedidosPeriodo,
  usePedidosSoloUv,
} from "@/lib/periodo";
import { cifrasPorLinea, pedidosDeLinea } from "@/dominio/por-linea";
import { lineasDelPedido } from "@/dominio/linea-producto";
import { EtiquetaUv } from "@/components/EtiquetaLinea";
import { cobrosDeTiendas, totalizar } from "@/dominio/facturacion";
import { agruparPorRangos, topPorMetros, variacion } from "@/dominio/kpis";
import { diaDelPedido } from "@/dominio/dia-pedido";
import { PERIODOS_CUADRO, tramosGrafica, tramosHastaHoy } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { TarjetaConcepto, TarjetaKpi } from "@/components/TarjetaKpi";
import { useCuentaResultados } from "@/lib/cuenta";
import { concepto, pctIva } from "@/dominio/cuenta";
import type { LucideIcon } from "lucide-react";
import { Download, Receipt, Percent, Truck, XCircle, Undo2 } from "lucide-react";
import { ConGrafica, IngresosPorTramo, TopProductosMetros } from "@/components/graficas/perezosas";
import { mensajeDeError } from "@/lib/errores";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";
import { ICONO } from "@/components/iconos";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/facturacion")({
  head: () => ({ meta: [{ title: "Facturación · DTF Culture" }] }),
  component: FacturacionTienda,
});

function FacturacionTienda() {
  const { tiendaId } = Route.useParams();
  // El periodo va en la dirección: sobrevive a recargar y se comparte.
  const periodo = usePeriodoUrl("mes");
  const { comparacion } = periodo;
  // Sin «todo» en la lista, siempre hay rango.
  const { desde, hasta } = periodo.rango!;

  const { data: tienda } = useQuery({
    queryKey: ["tienda-facturacion", tiendaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tiendas")
        .select("id, nombre")
        .eq("id", tiendaId)
        .maybeSingle();
      return data;
    },
  });

  // Sin comparación, un rango vacío: la consulta no puede ser condicional.
  const ant = comparacion?.previo ?? { desde: hasta, hasta: desde };

  const consultaPedidos = usePedidosPeriodo({ desde, hasta, tiendaId });
  const consultaAnterior = usePedidosPeriodo({ desde: ant.desde, hasta: ant.hasta, tiendaId });
  const consultaLineas = useLineasPeriodo({ desde, hasta, tiendaId });
  // Lo cobrado, por la fecha del cobro: el dinero que entró en el periodo.
  // Solo los de esta tienda, leídos así en la base (cobrosDeTiendas, abajo,
  // deja los mismos: los de esta tienda).
  const consultaCobros = useCobrosPeriodo({ desde, hasta }, "cobro", tiendaId);
  const consultaCobrosAnt = useCobrosPeriodo(ant, "cobro", tiendaId);

  // Todos los pedidos del periodo, para la exportación; las cifras van por
  // línea: arriba el DTF, y el DTF UV en su tarjeta (ver por-linea.ts). Un
  // pedido mixto se reparte entre las dos.
  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);
  const lineas = useMemo(() => cifrasPorLinea(pedidos), [pedidos]);
  const lineasPrev = useMemo(
    () => cifrasPorLinea(consultaAnterior.data ?? []),
    [consultaAnterior.data],
  );
  const k = lineas.dtf;
  const kPrev = lineasPrev.dtf;
  const uv = lineas.uv;
  const uvPrev = lineasPrev.uv;
  // Lo cobrado de los pedidos de DTF UV va con el UV, no con el DTF.
  const consultaSoloUv = usePedidosSoloUv(tiendaId);
  const soloUv = consultaSoloUv.data;
  const cobrosDisponibles = (consultaCobros.data?.disponible ?? false) && !!soloUv;
  const cobradoDe = (cobros: Parameters<typeof cobrosDeTiendas>[0], deUv: boolean) =>
    totalizar(
      cobrosDeTiendas(cobros, tiendaId).filter((c) => (soloUv?.has(c.pedido_id) ?? false) === deUv),
    ).cobrado;
  const cobradoUv = cobradoDe(consultaCobros.data?.cobros ?? [], true);

  const grafica = useMemo(() => {
    const { por, tramos: todos } = tramosGrafica({ desde, hasta });
    // Sin los días que aún no han llegado: no dejan medio gráfico vacío.
    const tramos = tramosHastaHoy(todos, new Date());
    const totales = agruparPorRangos(pedidosDeLinea(pedidos, "dtf"), tramos);
    return { por, datos: tramos.map((t, i) => ({ dia: t.etiqueta, total: totales[i].total })) };
  }, [pedidos, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? []),
    [consultaLineas.data],
  );

  // Las cifras de dinero, con la cuenta de resultados (cuenta.ts): las
  // mismas que en Inicio y en la Cuenta de resultados, por línea.
  const previo = comparacion?.previo ?? null;
  const lecturaDtf = useCuentaResultados({
    rango: { desde, hasta },
    previo,
    filtro: { tienda: tiendaId, linea: "dtf" },
    soloTienda: true,
    gastos: false,
  });
  const lecturaUv = useCuentaResultados({
    rango: { desde, hasta },
    previo,
    filtro: { tienda: tiendaId, linea: "uv" },
    soloTienda: true,
    gastos: false,
    dinero: false,
  });
  const c = lecturaDtf.cuenta;
  const cPrev = lecturaDtf.previa;
  const cUv = lecturaUv.cuenta;
  const cUvPrev = lecturaUv.previa;
  // El IVA se cobra sobre la base entera: las ventas más los portes.
  const ivaPct = c
    ? pctIva(c.iva.valor ?? 0, (c.ventas.valor ?? 0) + (c.portes_cobrados.valor ?? 0))
    : null;

  // Mientras llegan las del periodo nuevo se ven las del anterior: se avisa,
  // se atenúan y no se exportan.
  const deAntes =
    consultaPedidos.isPlaceholderData ||
    consultaAnterior.isPlaceholderData ||
    consultaCobros.isPlaceholderData ||
    consultaCobrosAnt.isPlaceholderData;
  const cargando = consultaPedidos.isPending;
  const error = consultaPedidos.error;
  const sinDatos = !cargando && !error && pedidos.length === 0;

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Estado", "Línea", "Metros DTF", "Metros UV", "Base", "IVA", "Envío", "Total"],
      // El día del pedido, el de su ticket y el de la lista de pedidos. Todos,
      // los de DTF UV también, con su línea para poder separarlos.
      ...pedidos.map((p) => [
        diaDelPedido(p),
        p.estado,
        { dtf: "DTF", uv: "DTF UV", mixto: "DTF + UV", ninguna: "" }[lineasDelPedido(p)],
        Number(p.metros_total ?? 0),
        Number(p.metros_uv ?? 0),
        Number(p.subtotal ?? 0),
        Number(p.iva ?? 0),
        Number(p.envio ?? 0),
        Number(p.total ?? 0),
      ]),
    ];
    const slug = (tienda?.nombre ?? "tienda").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    descargarCSV(
      `facturacion-${slug}_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`,
      filas,
    );
  }

  return (
    <div className="space-y-6">
      {/* Barra de herramientas */}
      <CabeceraPantalla
        tienda={tienda?.nombre}
        subtitulo={`Vista contable filtrada a ${tienda?.nombre ?? "esta tienda"}`}
        acciones={
          <>
            <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />

            <Button
              onClick={exportar}
              size="sm"
              variant="outline"
              disabled={pedidos.length === 0 || deAntes}
            >
              <Download className="h-4 w-4 mr-2" />
              Descargar Excel
            </Button>
          </>
        }
      />

      <AvisoActualizando activo={deAntes} />

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se ha podido cargar la facturación: {mensajeDeError(error)}
          </CardContent>
        </Card>
      )}

      {cargando && (
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {sinDatos && (
        <EstadoVacio
          icono={Receipt}
          titulo="Sin facturación en este periodo"
          descripcion={`Esta tienda no registró pedidos entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}.`}
        />
      )}

      {!cargando && !error && !sinDatos && (
        <div {...propsDatosDeAntes(deAntes, "space-y-6")}>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <TarjetaConcepto
              clave="ventas_netas"
              cifra={c?.ventas_netas ?? null}
              previa={cPrev?.ventas_netas}
              frente={comparacion?.etiqueta}
              icon={ICONO.vendido}
            />
            <TarjetaConcepto
              clave="margen_bruto"
              cifra={c?.margen_bruto ?? null}
              previa={cPrev?.margen_bruto}
              frente={comparacion?.etiqueta}
              icon={ICONO.margen}
              pie={
                c?.margenPct != null ? (
                  <span className="text-muted-foreground">
                    {numero(c.margenPct, 1)}&nbsp;% de las ventas netas
                  </span>
                ) : undefined
              }
            />
            <TarjetaConcepto
              clave="cobrado"
              cifra={c?.cobrado ?? null}
              previa={cPrev?.cobrado}
              frente={comparacion?.etiqueta}
              icon={ICONO.cobrado}
            />
            <TarjetaKpi
              titulo="Pedidos"
              explicacion="pedidos"
              valor={String(k.pedidos)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.pedidos, kPrev.pedidos)}
              icon={ICONO.pedidos}
            />
            <TarjetaKpi
              titulo="Ticket medio"
              explicacion="ticket"
              valor={eur(k.ticket)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.ticket, kPrev.ticket)}
              icon={ICONO.ticketMedio}
            />
            <TarjetaKpi
              titulo="Metros vendidos"
              explicacion="metros"
              valor={metros(k.metros)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.metros, kPrev.metros)}
              icon={ICONO.metros}
            />
            <TarjetaConcepto
              clave="devoluciones"
              cifra={c?.devoluciones ?? null}
              previa={cPrev?.devoluciones}
              icon={Undo2}
            />
            <TarjetaKpi
              titulo="Cancelados"
              explicacion="cancelados"
              valor={String(k.cancelados)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.cancelados, kPrev.cancelados)}
              icon={XCircle}
              color="destructive"
              deltaInverso
            />
          </div>

          {/* Desglose de facturación */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Bloque
              titulo={concepto("ventas").nombre}
              subtitulo={concepto("ventas").definicion}
              valor={c ? eur(c.ventas.valor) : "…"}
              icon={ICONO.ventas}
              tono="primary"
            />
            <Bloque
              titulo={concepto("portes_cobrados").nombre}
              subtitulo={concepto("portes_cobrados").definicion}
              valor={c ? eur(c.portes_cobrados.valor) : "…"}
              icon={Truck}
              tono="warn"
            />
            <Bloque
              titulo={concepto("iva").nombre}
              subtitulo={
                ivaPct === null
                  ? concepto("iva").definicion
                  : `${numero(ivaPct, 1)}\u00A0% sobre las ventas más los portes`
              }
              valor={c ? eur(c.iva.valor) : "…"}
              icon={Percent}
              tono="info"
            />
            <Bloque
              titulo={concepto("ventas_con_iva").nombre}
              subtitulo="Ventas + portes + IVA"
              valor={c ? eur(c.ventas_con_iva.valor) : "…"}
              icon={ICONO.ventasConIva}
              tono="success"
            />
          </div>

          {/* DTF UV: aparte, no es venta de DTF */}
          {(uv.pedidos > 0 || uvPrev.pedidos > 0 || cobradoUv > 0) && (
            <Card className="border-violet-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <EtiquetaUv />
                  Ventas de DTF UV
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Subcontratado: no cuenta en las cifras ni en los metros de arriba. Su margen bruto
                  son sus ventas netas menos lo que cobra la subcontrata.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
                  <TarjetaConcepto
                    clave="ventas_netas"
                    cifra={cUv?.ventas_netas ?? null}
                    previa={cUvPrev?.ventas_netas}
                    frente={comparacion?.etiqueta}
                    icon={ICONO.vendido}
                  />
                  <TarjetaConcepto
                    clave="ventas"
                    cifra={cUv?.ventas ?? null}
                    previa={cUvPrev?.ventas}
                    frente={comparacion?.etiqueta}
                    icon={ICONO.ventas}
                  />
                  <TarjetaKpi
                    titulo="Metros UV"
                    valor={metros(uv.metrosUv)}
                    frente={comparacion?.etiqueta}
                    delta={variacion(uv.metrosUv, uvPrev.metrosUv)}
                    icon={ICONO.metros}
                  />
                  <TarjetaConcepto
                    clave="margen_bruto"
                    cifra={cUv?.margen_bruto ?? null}
                    previa={cUvPrev?.margen_bruto}
                    frente={comparacion?.etiqueta}
                    icon={ICONO.margen}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    Pedidos: <span className="font-medium text-foreground">{uv.pedidos}</span>
                  </span>
                  <span>
                    Coste subcontrata:{" "}
                    <span className="font-medium text-foreground">{eur(uv.coste)}</span>
                  </span>
                  <span>
                    Ganancia por metro:{" "}
                    <span className="font-medium text-foreground">{eur(uv.gananciaMetro)}</span>
                  </span>
                  {cobrosDisponibles && (
                    <span>
                      Cobrado UV:{" "}
                      <span className="font-medium text-foreground">{eur(cobradoUv)}</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gráficas */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {grafica.por === "dia" ? "Ingresos por día" : "Ingresos por mes"}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ConGrafica>
                  <IngresosPorTramo datos={grafica.datos} />
                </ConGrafica>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top productos por metros</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {consultaLineas.isPending ? (
                  <Skeleton className="h-full w-full" />
                ) : topProductos.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Los pedidos de este periodo no tienen líneas de detalle.
                  </div>
                ) : (
                  <ConGrafica>
                    <TopProductosMetros datos={topProductos} />
                  </ConGrafica>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Bloque({
  titulo,
  subtitulo,
  valor,
  icon: Icon,
  tono,
}: {
  titulo: string;
  subtitulo: string;
  valor: string;
  icon: LucideIcon;
  tono: "primary" | "info" | "warn" | "success";
}) {
  const tonos: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-status-procesando/15 text-status-procesando",
    warn: "bg-status-pendiente/15 text-status-pendiente",
    success: "bg-status-completado/15 text-status-completado",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {titulo}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{subtitulo}</div>
          </div>
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tonos[tono]}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight">{valor}</div>
      </CardContent>
    </Card>
  );
}
