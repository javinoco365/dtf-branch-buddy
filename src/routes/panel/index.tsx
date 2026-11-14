import {
  createFileRoute,
  Link,
  type RegisteredRouter,
  type ValidateLinkOptions,
} from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { usePeriodoUrl, useLineaUrl } from "@/lib/filtros-url";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVacio } from "@/components/EstadoVacio";
import { ErrorCarga } from "@/components/ErrorCarga";
import { numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { AvisoActualizando } from "@/components/AvisoActualizando";
import { propsDatosDeAntes } from "@/lib/datos-de-antes";
import { useLineasPeriodo, usePedidosPeriodo } from "@/lib/periodo";
import { usePendientesCobro, useTaller } from "@/lib/gerencia";
import { useCuentaResultados } from "@/lib/cuenta";
import { useEstadoAvisoAgenda } from "@/hooks/use-agenda";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { ETIQUETA_FILTRO_LINEA, pedidosDeLinea } from "@/dominio/por-linea";
import {
  FILTRO_CUENTA_TODO,
  pedidosPorCobrarHoy,
  TODAS,
  ventasNetasPorTramo,
} from "@/dominio/cuenta";
import { infoEstado } from "@/dominio/estados";
import { pedidosDeHoy } from "@/dominio/hoy";
import { SelectorLinea } from "@/components/filtros/SelectorLinea";
import { topPorMetros } from "@/dominio/kpis";
import { diaDelPedido } from "@/dominio/dia-pedido";
import { PERIODOS_CUADRO, tramosGrafica, tramosHastaHoy } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { CifrasDelPeriodo } from "@/components/CifrasDelPeriodo";
import { CalendarCheck, Download, Inbox, Printer, Truck, type LucideIcon } from "lucide-react";
import { ConGrafica, IngresosPorTramo, TopProductosMetros } from "@/components/graficas/perezosas";
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
 * depende del periodo ni de la línea: es la foto de ahora. Son cuántos, no
 * cuánto: el importe pendiente está abajo, en «Pendiente de cobro».
 */
function Hoy() {
  const taller = useTaller();
  const pendientes = usePendientesCobro();
  const tareas = useEstadoAvisoAgenda();
  const pedidos = useMemo(() => (taller.data ? pedidosDeHoy(taller.data) : null), [taller.data]);
  const porCobrar = useMemo(
    () =>
      pendientes.data?.disponible
        ? pedidosPorCobrarHoy(pendientes.data.pedidos, FILTRO_CUENTA_TODO)
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
          detalle={taller.isError ? "No se pudo leer el taller" : "Pedidos sin imprimir"}
          icon={Printer}
          a={{ to: "/panel/gerencia", search: { pestana: "produccion" } }}
        />
        <CifraHoy
          titulo="Por enviar"
          valor={cifraPedidos(pedidos?.porEnviar)}
          detalle={taller.isError ? "No se pudo leer el taller" : "Pedidos listos"}
          icon={Truck}
          a={{ to: "/panel/pedidos", search: { periodo: "todo", estado: "listo" } }}
        />
        <CifraHoy
          titulo="Pedidos por cobrar"
          valor={
            porCobrar !== null
              ? numero(porCobrar, 0)
              : pendientes.isError || pendientes.data
                ? "—"
                : "…"
          }
          detalle={
            pendientes.isError
              ? "No se pudo leer lo pendiente"
              : pendientes.data && !pendientes.data.disponible
                ? "Esta parte aún no está activada"
                : "Con algo pendiente de cobro"
          }
          icon={ICONO.pendienteCobro}
          a={{ to: "/panel/cobros" }}
        />
        <CifraHoy
          titulo="Mis tareas"
          valor={tareas.aviso !== null ? numero(tareas.aviso, 0) : tareas.cargando ? "…" : "—"}
          detalle={
            tareas.error
              ? "No se pudo leer la Agenda"
              : (tareas.motivo ?? "De hoy, vencidas o nuevas")
          }
          icon={CalendarCheck}
          a={{ to: "/panel/agenda" }}
        />
      </div>
    </section>
  );
}

type PropsCifraHoy<TOpciones = unknown> = {
  titulo: string;
  valor: string;
  detalle: ReactNode;
  icon: LucideIcon;
  /** A dónde lleva: la ruta y su búsqueda, comprobadas con los tipos de las rutas. */
  a: ValidateLinkOptions<RegisteredRouter, TOpciones>;
};

/** Una cifra de «Hoy»: una tarjeta que lleva a su pantalla. */
function CifraHoy<TOpciones>(props: PropsCifraHoy<TOpciones>): ReactNode;
function CifraHoy({ titulo, valor, detalle, icon, a }: PropsCifraHoy) {
  return (
    <Link
      {...a}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TarjetaKpi
        titulo={titulo}
        valor={valor}
        delta={null}
        icon={icon}
        pie={<span className="text-muted-foreground">{detalle}</span>}
        className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40"
      />
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
  const { data: tiendas } = useTiendasMenu();

  const lectura = useCuentaResultados({
    rango,
    previo: comparacion?.previo ?? null,
    filtro,
    gastos: false,
  });
  const { cuenta } = lectura;

  // Para la gráfica, los productos y la descarga: los pedidos de las tiendas.
  const consultaPedidos = usePedidosPeriodo({ desde, hasta });
  const consultaLineas = useLineasPeriodo({ desde, hasta });
  const pedidosDeLaLinea = useMemo(
    () => (consultaPedidos.data ? pedidosDeLinea(consultaPedidos.data, linea) : []),
    [consultaPedidos.data, linea],
  );

  // Las ventas netas de cada día (o mes), con la misma regla que la cifra de
  // arriba: sin IVA, tiendas y textil, sin los web sin pagar, cada devolución
  // en su día y lo facturado sin pedido en el de su factura.
  const { entrada, sinPedidoDe } = lectura;
  const grafica = useMemo(() => {
    const { por, tramos: todos } = tramosGrafica({ desde, hasta });
    // Sin los días que aún no han llegado: no dejan medio gráfico vacío.
    const tramos = tramosHastaHoy(todos, new Date());
    if (!entrada) return { por, datos: null };
    const netas = ventasNetasPorTramo(entrada, tramos, sinPedidoDe);
    return { por, datos: tramos.map((t, i) => ({ dia: t.etiqueta, total: netas[i] })) };
  }, [entrada, sinPedidoDe, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? [], 6, linea),
    [consultaLineas.data, linea],
  );

  // Mientras llegan las del periodo nuevo se ven las del anterior: se avisa,
  // se atenúan y no se descargan.
  const deAntes = lectura.deAntes || consultaPedidos.isPlaceholderData;
  const sinPedidos = !!cuenta && cuenta.pedidos === 0 && (cuenta.devoluciones.valor ?? 0) === 0;
  const frente = comparacion?.etiqueta;

  function descargar() {
    const nombreTienda = new Map((tiendas ?? []).map((t) => [t.id, t.nombre]));
    const filas: (string | number)[][] = [
      ["Fecha", "Tienda", "Estado", "Metros DTF", "Metros UV", "Base", "IVA", "Envío", "Total"],
      // El día del pedido, el de su ticket y el de la lista de pedidos. Con
      // la línea elegida: de un pedido mixto, solo su parte.
      ...pedidosDeLaLinea.map((p) => [
        diaDelPedido(p),
        nombreTienda.get(p.tienda_id) ?? p.tienda_id,
        infoEstado("pedido", p.estado).etiqueta,
        Number(p.metros_total ?? 0),
        Number(p.metros_uv ?? 0),
        Number(p.subtotal ?? 0),
        Number(p.iva ?? 0),
        Number(p.envio ?? 0),
        Number(p.total ?? 0),
      ]),
    ];
    const deLinea = linea !== "todo" ? `_${linea}` : "";
    const nombre = `inicio_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}${deLinea}.csv`;
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
            {linea !== "todo" ? ` · solo ${ETIQUETA_FILTRO_LINEA[linea]}` : ""}. Los productos y la
            descarga, solo de las tiendas.{" "}
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
            disabled={pedidosDeLaLinea.length === 0 || deAntes}
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Excel
          </Button>
        </div>
      </div>

      <AvisoActualizando activo={deAntes} />

      {lectura.error ? (
        <ErrorCarga
          error={lectura.error}
          onReintentar={lectura.reintentar}
          reintentando={lectura.reintentando}
          que="las cifras del periodo"
        />
      ) : (
        // Las cuatro, siempre: sin pedidos en el periodo puede haber cobros
        // de pedidos de antes, y lo pendiente es de hoy.
        <div {...propsDatosDeAntes(deAntes)}>
          <CifrasDelPeriodo
            lectura={lectura}
            frente={frente}
            pieCobrado={
              linea !== "todo" ? (
                <span className="text-muted-foreground">
                  Por pedido: los de pedidos mixtos (DTF y DTF UV), con el DTF.
                </span>
              ) : undefined
            }
            piePendiente="Hoy, sea del periodo que sea"
          />
        </div>
      )}

      {sinPedidos ? (
        <EstadoVacio
          icono={Inbox}
          titulo="Sin pedidos en este periodo"
          descripcion={`No hay ningún pedido registrado entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}. Cambia de periodo o sincroniza una tienda para ver datos aquí.`}
        />
      ) : (
        <div {...propsDatosDeAntes(deAntes, "grid gap-4 lg:grid-cols-2")}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {grafica.por === "dia" ? "Ventas netas por día" : "Ventas netas por mes"}
              </CardTitle>
              <CardDescription>
                Sin IVA, tiendas y textil. Cada devolución resta en su día.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {lectura.error ? (
                <ErrorCarga
                  sinMarco
                  error={lectura.error}
                  onReintentar={lectura.reintentar}
                  reintentando={lectura.reintentando}
                  que="las ventas del periodo"
                />
              ) : !grafica.datos ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ConGrafica>
                  <IngresosPorTramo datos={grafica.datos} nombre="Ventas netas" etiquetaConColor />
                </ConGrafica>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top productos por metros</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {consultaLineas.error ? (
                <ErrorCarga
                  sinMarco
                  error={consultaLineas.error}
                  onReintentar={consultaLineas.refetch}
                  reintentando={consultaLineas.isRefetching}
                  que="las líneas de los pedidos"
                />
              ) : consultaLineas.isPending ? (
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
      )}
    </section>
  );
}
