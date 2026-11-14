import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { usePeriodoUrl, useLineaUrl } from "@/lib/filtros-url";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVacio } from "@/components/EstadoVacio";
import { eur, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { AvisoActualizando } from "@/components/AvisoActualizando";
import { propsDatosDeAntes } from "@/lib/datos-de-antes";
import { useLineasPeriodo, usePedidosPeriodo } from "@/lib/periodo";
import { usePendientesCobro, useTaller } from "@/lib/gerencia";
import { useCuentaResultados } from "@/lib/cuenta";
import { useAvisoAgenda } from "@/hooks/use-agenda";
import { ETIQUETA_FILTRO_LINEA, pedidosDeLinea } from "@/dominio/por-linea";
import { FILTRO_CUENTA_TODO, pendienteDeCobroHoy, TODAS } from "@/dominio/cuenta";
import { pedidosDeHoy } from "@/dominio/hoy";
import { SelectorLinea } from "@/components/filtros/SelectorLinea";
import { agruparPorRangos, topPorMetros } from "@/dominio/kpis";
import { diaDelPedido } from "@/dominio/dia-pedido";
import { PERIODOS_CUADRO, tramosGrafica, tramosHastaHoy } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { TarjetaConcepto } from "@/components/TarjetaKpi";
import {
  CalendarCheck,
  Clock,
  Download,
  Inbox,
  Percent,
  Printer,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { ConGrafica, IngresosPorTramo, TopProductosMetros } from "@/components/graficas/perezosas";
import { mensajeDeError } from "@/lib/errores";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";
import { ICONO } from "@/components/iconos";

export const Route = createFileRoute("/panel/")({
  head: () => ({ meta: [{ title: "Inicio · DTF Culture" }] }),
  component: DashboardGlobal,
});

function DashboardGlobal() {
  return (
    <div className="space-y-6">
      <Hoy />
      <DelPeriodo />
    </div>
  );
}

/**
 * Lo que hay que hacer hoy, en cuatro números que llevan a su pantalla. No
 * depende del periodo ni de la línea: es la foto de ahora.
 */
function Hoy() {
  const taller = useTaller();
  const pendientes = usePendientesCobro();
  const tareas = useAvisoAgenda();
  const pedidos = useMemo(() => (taller.data ? pedidosDeHoy(taller.data) : null), [taller.data]);
  const pendiente = useMemo(
    () =>
      pendientes.data?.disponible
        ? pendienteDeCobroHoy(pendientes.data.pedidos, FILTRO_CUENTA_TODO)
        : null,
    [pendientes.data],
  );
  const cifraPedidos = (n: number | undefined) =>
    taller.isError ? "—" : n === undefined ? "…" : numero(n, 0);

  return (
    <section aria-labelledby="titulo-hoy" className="space-y-3">
      {/* «Hoy» y no «Inicio»: es lo primero que se ve al entrar, y lo que dice. */}
      <CabeceraPantalla id="titulo-hoy" titulo="Hoy" />
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <CifraHoy
          titulo="Por producir"
          valor={cifraPedidos(pedidos?.porProducir)}
          detalle="Pedidos sin imprimir"
          icon={Printer}
          a={{ to: "/panel/gerencia", search: { pestana: "produccion" } }}
        />
        <CifraHoy
          titulo="Por enviar"
          valor={cifraPedidos(pedidos?.porEnviar)}
          detalle="Pedidos listos"
          icon={Truck}
          a={{ to: "/panel/pedidos", search: { periodo: "todo", estado: "listo" } }}
        />
        <CifraHoy
          titulo="Cobros pendientes"
          valor={
            pendiente !== null ? eur(pendiente) : pendientes.isError || pendientes.data ? "—" : "…"
          }
          detalle="Lo que nos deben"
          icon={Clock}
          a={{ to: "/panel/cobros" }}
        />
        <CifraHoy
          titulo="Mis tareas"
          valor={numero(tareas, 0)}
          detalle="De hoy, vencidas o nuevas"
          icon={CalendarCheck}
          a={{ to: "/panel/agenda" }}
        />
      </div>
    </section>
  );
}

function CifraHoy({
  titulo,
  valor,
  detalle,
  icon: Icon,
  a,
}: {
  titulo: string;
  valor: string;
  detalle: ReactNode;
  icon: LucideIcon;
  a: { to: string; search?: Record<string, string> };
}) {
  return (
    <Link
      to={a.to as never}
      search={a.search as never}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40">
        <CardContent className="flex items-start justify-between gap-3 p-3.5 md:p-5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:text-xs">
              {titulo}
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums md:text-3xl">{valor}</div>
            <div className="mt-1 text-xs text-muted-foreground">{detalle}</div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary max-md:hidden">
            <Icon className="h-5 w-5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Las cuatro cifras del periodo, con el nombre y la cuenta de la Cuenta de
 * resultados: ventas netas, margen bruto, cobrado y pendiente de cobro. El
 * resto (ticket medio, devoluciones, cancelados…) está en esa pantalla.
 */
function DelPeriodo() {
  // El periodo va en la dirección: sobrevive a recargar y se comparte.
  const periodo = usePeriodoUrl("mes");
  const { comparacion } = periodo;
  // Sin «todo» en la lista, siempre hay rango.
  const rango = periodo.rango!;
  const { desde, hasta } = rango;
  // La línea de producto: las dos, DTF o DTF UV (por-linea.ts).
  const [linea, cambiarLinea] = useLineaUrl();
  const filtro = useMemo(() => ({ tienda: TODAS, linea }), [linea]);

  const lectura = useCuentaResultados({
    rango,
    previo: comparacion?.previo ?? null,
    filtro,
    gastos: false,
  });
  const { cuenta, previa } = lectura;

  // Para la gráfica, los productos y la descarga: los pedidos de las tiendas.
  const consultaPedidos = usePedidosPeriodo({ desde, hasta });
  const consultaLineas = useLineasPeriodo({ desde, hasta });
  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);

  const grafica = useMemo(() => {
    const { por, tramos: todos } = tramosGrafica({ desde, hasta });
    // Sin los días que aún no han llegado: no dejan medio gráfico vacío.
    const tramos = tramosHastaHoy(todos, new Date());
    const totales = agruparPorRangos(pedidosDeLinea(pedidos, linea), tramos);
    return { por, datos: tramos.map((t, i) => ({ dia: t.etiqueta, total: totales[i].total })) };
  }, [pedidos, linea, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? [], 6, linea),
    [consultaLineas.data, linea],
  );

  // Mientras llegan las del periodo nuevo se ven las del anterior: se avisa,
  // se atenúan y no se descargan.
  const deAntes = lectura.deAntes || consultaPedidos.isPlaceholderData;
  const sinDatos = !!cuenta && cuenta.pedidos === 0 && (cuenta.devoluciones.valor ?? 0) === 0;
  const frente = comparacion?.etiqueta;

  function descargar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Tienda", "Estado", "Metros DTF", "Metros UV", "Base", "IVA", "Envío", "Total"],
      // El día del pedido, el de su ticket y el de la lista de pedidos.
      ...pedidos.map((p) => [
        diaDelPedido(p),
        p.tienda_id,
        p.estado,
        Number(p.metros_total ?? 0),
        Number(p.metros_uv ?? 0),
        Number(p.subtotal ?? 0),
        Number(p.iva ?? 0),
        Number(p.envio ?? 0),
        Number(p.total ?? 0),
      ]),
    ];
    const nombre = `inicio_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`;
    descargarCSV(nombre, filas);
  }

  return (
    <section aria-labelledby="titulo-periodo" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="titulo-periodo" className="text-xl font-bold">
            El periodo
          </h2>
          <p className="text-sm text-muted-foreground">
            Tiendas y textil, sin IVA salvo el dinero
            {linea !== "todo" ? ` · solo ${ETIQUETA_FILTRO_LINEA[linea]}` : ""}.{" "}
            <Link to="/panel/cuenta-resultados" className="text-primary hover:underline">
              Ver la cuenta de resultados
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />
          <SelectorLinea valor={linea} alCambiar={cambiarLinea} />
          <Button
            onClick={descargar}
            size="sm"
            variant="outline"
            disabled={pedidos.length === 0 || deAntes}
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Excel
          </Button>
        </div>
      </div>

      <AvisoActualizando activo={deAntes} />

      {lectura.error && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-destructive">
            <span>No se han podido cargar las cifras: {mensajeDeError(lectura.error)}</span>
            <Button size="sm" variant="outline" onClick={lectura.reintentar}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {lectura.cargando && (
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {sinDatos && (
        <EstadoVacio
          icono={Inbox}
          titulo="Sin pedidos en este periodo"
          descripcion={`No hay ningún pedido registrado entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}. Cambia de periodo o sincroniza una tienda para ver datos aquí.`}
        />
      )}

      {cuenta && !sinDatos && (
        <div {...propsDatosDeAntes(deAntes, "space-y-6")}>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <TarjetaConcepto
              clave="ventas_netas"
              cifra={cuenta.ventas_netas}
              previa={previa?.ventas_netas}
              frente={frente}
              icon={ICONO.vendido}
            />
            <TarjetaConcepto
              clave="margen_bruto"
              cifra={cuenta.margen_bruto}
              previa={previa?.margen_bruto}
              frente={frente}
              icon={Percent}
              pie={
                cuenta.margenPct !== null ? (
                  <span className="text-muted-foreground">
                    {numero(cuenta.margenPct, 1)}&nbsp;% de las ventas netas
                  </span>
                ) : undefined
              }
            />
            <TarjetaConcepto
              clave="cobrado"
              cifra={cuenta.cobrado}
              previa={previa?.cobrado}
              frente={frente}
              icon={ICONO.cobrado}
              pie={
                linea !== "todo" ? (
                  <span className="text-muted-foreground">
                    Por pedido: los de pedidos mixtos (DTF y DTF UV), con el DTF.
                  </span>
                ) : undefined
              }
            />
            <TarjetaConcepto
              clave="pendiente_cobro"
              cifra={cuenta.pendiente_cobro}
              icon={Clock}
              pie={<span className="text-muted-foreground">Hoy, sea del periodo que sea</span>}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {grafica.por === "dia" ? "Ingresos por día" : "Ingresos por mes"}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ConGrafica>
                  <IngresosPorTramo datos={grafica.datos} etiquetaConColor />
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
    </section>
  );
}
