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
import { useCobrosPeriodo, useLineasPeriodo, usePedidosPeriodo } from "@/lib/periodo";
import { cobrosDeTiendas, totalizar } from "@/dominio/facturacion";
import { agruparPorRangos, calcularKpis, topPorMetros, variacion } from "@/dominio/kpis";
import { PERIODOS_CUADRO, tramosGrafica } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import type { LucideIcon } from "lucide-react";
import {
  Download,
  Euro,
  Receipt,
  Percent,
  Truck,
  Wallet,
  Ruler,
  ShoppingCart,
  XCircle,
  ClipboardList,
  Undo2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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
  const consultaCobros = useCobrosPeriodo({ desde, hasta }, "cobro");
  const consultaCobrosAnt = useCobrosPeriodo(ant, "cobro");

  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);
  const k = useMemo(() => calcularKpis(pedidos), [pedidos]);
  const kPrev = useMemo(() => calcularKpis(consultaAnterior.data ?? []), [consultaAnterior.data]);
  const cobrosDisponibles = consultaCobros.data?.disponible ?? false;
  const cobrado = totalizar(cobrosDeTiendas(consultaCobros.data?.cobros ?? [], tiendaId)).cobrado;
  const cobradoPrev = totalizar(
    cobrosDeTiendas(consultaCobrosAnt.data?.cobros ?? [], tiendaId),
  ).cobrado;

  const grafica = useMemo(() => {
    const { por, tramos } = tramosGrafica({ desde, hasta });
    const totales = agruparPorRangos(pedidos, tramos);
    return { por, datos: tramos.map((t, i) => ({ dia: t.etiqueta, total: totales[i].total })) };
  }, [pedidos, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? []),
    [consultaLineas.data],
  );

  const pctIva = k.bruta === 0 ? 0 : (k.iva / k.bruta) * 100;

  const cargando = consultaPedidos.isPending;
  const error = consultaPedidos.error;
  const sinDatos = !cargando && !error && pedidos.length === 0;

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Estado", "Metros", "Base", "IVA", "Envío", "Total"],
      ...pedidos.map((p) => [
        format(new Date(p.fecha_pedido), "yyyy-MM-dd"),
        p.estado,
        Number(p.metros_total ?? 0),
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Facturación</h2>
          <p className="text-sm text-muted-foreground">
            Vista contable filtrada a {tienda?.nombre ?? "esta tienda"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />

          <Button onClick={exportar} size="sm" disabled={pedidos.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se ha podido cargar la facturación: {error.message}
          </CardContent>
        </Card>
      )}

      {cargando && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaKpi
              titulo="Vendido"
              explicacion="vendido"
              valor={eur(k.total)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.total, kPrev.total)}
              icon={Euro}
            />
            <TarjetaKpi
              titulo="Facturación bruta"
              explicacion="bruta"
              valor={eur(k.bruta)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.bruta, kPrev.bruta)}
              icon={Receipt}
            />
            <TarjetaKpi
              titulo="Cobrado"
              explicacion="cobrado"
              valor={cobrosDisponibles ? eur(cobrado) : "—"}
              frente={comparacion?.etiqueta}
              delta={cobrosDisponibles ? variacion(cobrado, cobradoPrev) : null}
              icon={Wallet}
            />
            <TarjetaKpi
              titulo="Pedidos"
              explicacion="pedidos"
              valor={String(k.pedidos)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.pedidos, kPrev.pedidos)}
              icon={ClipboardList}
            />
            <TarjetaKpi
              titulo="Ticket medio"
              explicacion="ticket"
              valor={eur(k.ticket)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.ticket, kPrev.ticket)}
              icon={ShoppingCart}
            />
            <TarjetaKpi
              titulo="Metros vendidos"
              explicacion="metros"
              valor={metros(k.metros)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.metros, kPrev.metros)}
              icon={Ruler}
            />
            <TarjetaKpi
              titulo="Devoluciones"
              explicacion="devoluciones"
              valor={eur(k.devuelto)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.devuelto, kPrev.devuelto)}
              icon={Undo2}
              deltaInverso
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
              titulo="Bruta"
              subtitulo="Base imponible"
              valor={eur(k.bruta)}
              icon={Receipt}
              tono="primary"
            />
            <Bloque
              titulo="IVA"
              subtitulo={`${numero(pctIva, 1)}% sobre bruta`}
              valor={eur(k.iva)}
              icon={Percent}
              tono="info"
            />
            <Bloque
              titulo="Envíos"
              subtitulo="Portes sin IVA; ya van dentro de la bruta"
              valor={eur(k.envios)}
              icon={Truck}
              tono="warn"
            />
            <Bloque
              titulo="Total"
              subtitulo="Bruta + IVA (el envío va en la bruta)"
              valor={eur(k.total)}
              icon={Wallet}
              tono="success"
            />
          </div>

          {/* Gráficas */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {grafica.por === "dia" ? "Ingresos por día" : "Ingresos por mes"}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafica.datos}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => eur(v)}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductos} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v} m`}
                      />
                      <YAxis
                        type="category"
                        dataKey="producto"
                        width={140}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(v: number) => metros(v)}
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="metros" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
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
