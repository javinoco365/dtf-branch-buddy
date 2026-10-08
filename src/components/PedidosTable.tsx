import { lazy, Suspense, useMemo, useState } from "react";
import { useFiltrosUrl, usePeriodoUrl, useTextoDiferido } from "@/lib/filtros-url";
import { useTiendas } from "@/lib/periodo";
import { PERIODOS_CUADRO } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { eur, metros, numero } from "@/lib/format";
import { esEstimado } from "@/dominio/metros-woo";
import { descargarCSV } from "@/lib/csv";
import {
  lineasDireccion,
  mismaDireccion as sonLaMismaDireccion,
  type Direccion,
} from "@/dominio/direcciones";
import {
  deletePedido,
  listPedidos,
  updatePedidoEstado,
  type DocumentoDeLista,
} from "@/lib/pedidos.functions";
import { generarYSubirFacturaPDF } from "@/lib/facturas.functions";
import type { Cobro } from "@/lib/cobros.functions";
import { resumenCobros } from "@/dominio/cobros";
import { totalesPedidos, type TotalesPedidos } from "@/dominio/sumatorios";
import { describirPedidos } from "@/dominio/sumatorios-pedidos";
import { EstadoCobroTexto } from "@/components/cobros/CobrosPedidoDialog";
import { sincronizarWoo } from "@/lib/woocommerce.functions";
import { exportarPedidosParaAnalisis } from "@/lib/export-analisis";
const PedidoFormDialog = lazy(() =>
  import("@/components/PedidoFormDialog").then((m) => ({ default: m.PedidoFormDialog })),
);
const PedidoTrackingDialog = lazy(() =>
  import("@/components/PedidoTrackingDialog").then((m) => ({ default: m.PedidoTrackingDialog })),
);
const FacturarPedidoDialog = lazy(() =>
  import("@/components/FacturarPedidoDialog").then((m) => ({ default: m.FacturarPedidoDialog })),
);
const FacturarPedidosDialog = lazy(() =>
  import("@/components/documentos/FacturarPedidosDialog").then((m) => ({
    default: m.FacturarPedidosDialog,
  })),
);
const CobrosPedidoDialog = lazy(() =>
  import("@/components/cobros/CobrosPedidoDialog").then((m) => ({
    default: m.CobrosPedidoDialog,
  })),
);
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type { Direccion };

export type PedidoFila = {
  id: string;
  tienda_id: string;
  tienda_nombre: string | null;
  woo_order_id: number | null;
  numero: string;
  estado: string;
  metros_total: number;
  subtotal: number;
  iva: number;
  total: number;
  fecha_pedido: string;
  notas: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_email: string | null;
  cliente_telefono: string | null;
  direccion_facturacion: Direccion | null;
  direccion_envio: Direccion | null;
  origen: string | null;
  metodo_pago: string | null;
  envio: number;
  items: {
    id: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
    precio_unitario: number;
    /** El tipo de IVA de la línea. Puede faltar en pedidos antiguos. */
    iva_rate: number | null;
    subtotal: number;
    iva: number;
    total: number;
    /** De dónde salen los metros (20261020100000). Falta en líneas antiguas. */
    metros_origen?: string | null;
    precio_metro_usado?: number | null;
  }[];
  tracking: {
    id: string;
    transportista: string | null;
    codigo_seguimiento: string | null;
    url: string | null;
  } | null;
  /** Vacío también si la migración de cobros no está aplicada. */
  cobros: Cobro[];
  /** El ticket o la factura que cuenta para el pedido, si lo tiene. */
  documento?: DocumentoDeLista | null;
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_produccion: "Procesando",
  imprimiendo: "Imprimiendo",
  listo: "Listo",
  enviado: "Enviado",
  entregado: "Completado",
  cancelado: "Cancelado",
};

const ESTADOS = Object.keys(ESTADO_LABEL);

const FILTROS_PEDIDOS = {
  q: "",
  estado: "todos",
  cobro: "todos",
  origen: "todos",
  tienda: "todas",
};

function estadoVariant(estado: string): "default" | "secondary" | "destructive" | "outline" {
  if (estado === "entregado") return "default";
  if (estado === "cancelado") return "destructive";
  if (estado === "pendiente") return "outline";
  return "secondary";
}

const CLAVE_SINCRONIZAR = ["sincronizar-woo"];
const CLAVE_EXPORTAR = ["exportar-analisis"];

export function PedidosTable({ tiendaId }: { tiendaId?: string }) {
  const queryClient = useQueryClient();
  // Los filtros viven en la dirección: sobreviven a recargar y se comparten.
  const { valores: f, cambiar, quitar, hay } = useFiltrosUrl(FILTROS_PEDIDOS);
  // Sin «todo»: una tienda con años de pedidos no se carga de una vez.
  const periodo = usePeriodoUrl("mes");
  const [busqueda, setBusqueda] = useTextoDiferido(f.q, (q) => cambiar({ q }));
  const estadoFiltro = f.estado;
  // En la vista global se puede elegir tienda, y se pide solo esa al servidor.
  const tiendaConsulta = tiendaId ?? (f.tienda !== "todas" ? f.tienda : undefined);
  const { data: tiendasLista = [] } = useTiendas();
  const [expandida, setExpandida] = useState<string | null>(null);

  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editar, setEditar] = useState<PedidoFila | null>(null);
  const [tracking, setTracking] = useState<PedidoFila | null>(null);
  const [borrar, setBorrar] = useState<PedidoFila | null>(null);
  const [facturar, setFacturar] = useState<PedidoFila | null>(null);
  const [cobrando, setCobrando] = useState<PedidoFila | null>(null);
  const [facturandoVarios, setFacturandoVarios] = useState(false);

  const { desde, hasta } = periodo.rango!;
  const list = useServerFn(listPedidos);
  const sincronizarFn = useServerFn(sincronizarWoo);
  const sincronizar = useMutation({
    mutationKey: CLAVE_SINCRONIZAR,
    mutationFn: () => sincronizarFn({ data: { tienda_id: tiendaId! } }),
    onSuccess: (r: any) => {
      toast.success(
        `Sincronizado: ${r?.pedidos ?? 0} pedidos, ${r?.clientes ?? 0} clientes, ` +
          `${r?.productos ?? 0} productos`,
      );
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo sincronizar"),
  });

  // Todos los pedidos de la tienda (o de todas), no solo los del periodo: es
  // para analizarlos fuera del CRM. La tienda va con el clic, y el nombre lo
  // devuelve la exportación: si el filtro cambia mientras tanto, el aviso
  // sigue hablando de lo que se exportó.
  const exportarAnalisis = useMutation({
    mutationKey: CLAVE_EXPORTAR,
    mutationFn: (tienda: string | undefined) => exportarPedidosParaAnalisis({ tiendaId: tienda }),
    onSuccess: (r) => {
      toast.success(`Exportados ${numero(r.pedidos, 0)} pedidos de ${r.alcance}`, {
        description: r.avisos.join(" ") || undefined,
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo exportar"),
  });
  // Exportar mientras se sincroniza leería pedidos a medio reescribir. Por la
  // clave, y no por el estado de cada botón, para que el bloqueo siga aunque
  // se pase de la vista de una tienda a la de todas (en esta pestaña).
  const ocupado =
    useIsMutating({ mutationKey: CLAVE_SINCRONIZAR }) +
      useIsMutating({ mutationKey: CLAVE_EXPORTAR }) >
    0;

  const setEstadoFn = useServerFn(updatePedidoEstado);
  const delFn = useServerFn(deletePedido);

  const queryKey = ["pedidos", tiendaConsulta ?? "all", desde.toISOString(), hasta.toISOString()];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      list({
        data: { tiendaId: tiendaConsulta, desde: desde.toISOString(), hasta: hasta.toISOString() },
      }),
  });

  const pedidos: PedidoFila[] = (data?.pedidos ?? []) as any;
  const cobrosDisponibles = data?.cobrosDisponibles ?? true;

  const estadoMut = useMutation({
    mutationFn: (vars: { id: string; estado: string }) =>
      setEstadoFn({ data: { id: vars.id, estado: vars.estado as any } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      if (res?.woo_synced) toast.success("Estado actualizado y sincronizado con WooCommerce");
      else toast.success("Estado actualizado");
    },
    onError: (e: any) => toast.error(e?.message || "Error al actualizar estado"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      toast.success("Pedido borrado");
      setBorrar(null);
    },
    onError: (e: any) => toast.error(e?.message || "Error al borrar"),
  });

  const filtrados = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (estadoFiltro !== "todos" && p.estado !== estadoFiltro) return false;
      if (f.origen === "web" && p.origen !== "woocommerce") return false;
      if (f.origen === "manual" && p.origen === "woocommerce") return false;
      if (f.cobro !== "todos") {
        // «Pendiente» incluye lo cobrado en parte: es lo que falta por cobrar.
        const e = resumenCobros(p.total, p.cobros ?? []).estado;
        if (f.cobro === "pendiente" && e !== "pendiente" && e !== "parcial") return false;
        if (f.cobro === "parcial" && e !== "parcial") return false;
        if (f.cobro === "cobrado" && e !== "cobrado" && e !== "excedido") return false;
      }
      if (!q) return true;
      return (
        (p.cliente_nombre ?? "").toLowerCase().includes(q) ||
        (p.cliente_email ?? "").toLowerCase().includes(q) ||
        p.numero.toLowerCase().includes(q)
      );
    });
  }, [pedidos, f.q, f.origen, f.cobro, estadoFiltro]);

  // Agrupar por día
  // «Facturar»: los pedidos de lo que se está viendo sin ticket ni factura, del
  // más antiguo al más nuevo. Como mucho 500 de una vez.
  const sinDocumento = useMemo(
    () =>
      filtrados
        .filter((p) => p.estado !== "cancelado" && !p.documento)
        .sort((a, b) => a.fecha_pedido.localeCompare(b.fecha_pedido)),
    [filtrados],
  );

  const grupos = useMemo(() => {
    const map = new Map<string, PedidoFila[]>();
    for (const p of filtrados) {
      const k = format(new Date(p.fecha_pedido), "yyyy-MM-dd");
      const arr = map.get(k) ?? [];
      arr.push(p);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([fecha, lista]) => ({
        fecha,
        lista,
        // Lo mismo en la cabecera del día que en su pie: sin los cancelados.
        totales: totalesPedidos(lista),
      }));
  }, [filtrados]);

  // La barra de filtros y el total del periodo, de la misma lista y con la
  // misma función que cada día, para que las cifras no se contradigan.
  const totalesPeriodo = useMemo(() => totalesPedidos(filtrados), [filtrados]);

  function exportar() {
    const filas: (string | number)[][] = [
      [
        "Fecha",
        "Nº",
        "Tienda",
        "Cliente",
        "Email",
        "Estado",
        "Origen",
        "Pago",
        "Total",
        "Cobrado",
        "Pendiente",
      ],
      ...filtrados.map((p) => {
        const cobro = resumenCobros(p.total, p.cobros ?? []);
        return [
          format(new Date(p.fecha_pedido), "yyyy-MM-dd"),
          p.numero,
          p.tienda_nombre ?? "",
          p.cliente_nombre ?? "",
          p.cliente_email ?? "",
          ESTADO_LABEL[p.estado] ?? p.estado,
          p.origen ?? "",
          p.metodo_pago ?? "",
          p.total,
          cobro.cobrado,
          cobro.pendiente,
        ];
      }),
    ];
    descargarCSV(`pedidos-${format(desde, "yyyy-MM-dd")}.csv`, filas);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} className="max-md:w-full" />
        {/* Se parte en dos filas si no cabe, a cualquier ancho: en una tableta
            con la barra lateral, una sola fila se salía de la pantalla. */}
        <div className="ml-auto flex flex-wrap justify-end gap-2 max-md:ml-0 max-md:justify-start">
          {/* Solo con una tienda delante: sincronizar «todas» no significa
              nada, cada una tiene sus credenciales y su web. */}
          {tiendaId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => sincronizar.mutate()}
              disabled={ocupado}
            >
              {sincronizar.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {sincronizar.isPending ? "Sincronizando…" : "Sincronizar"}
            </Button>
          )}
          {/* Un solo botón para las dos exportaciones: con uno más, la barra
              no cabía en una fila en un portátil y se salía en una tableta. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {exportarAnalisis.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {exportarAnalisis.isPending ? "Exportando…" : "Exportar"}
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={exportar}>
                <Download />
                <div>
                  <div>CSV</div>
                  <div className="text-xs text-muted-foreground">
                    Los pedidos que se ven, para abrir en Excel
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportarAnalisis.mutate(tiendaConsulta)}
                disabled={ocupado}
              >
                <FileJson />
                <div>
                  <div>Para análisis</div>
                  <div className="text-xs text-muted-foreground">
                    Todos los pedidos de{" "}
                    {tiendaConsulta
                      ? (tiendasLista.find((t) => t.id === tiendaConsulta)?.nombre ?? "la tienda")
                      : "todas las tiendas"}
                    , de todas las fechas, con líneas, cobros y documentos, en un JSON que se
                    explica solo (para Claude)
                  </div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFacturandoVarios(true)}
            title="Emitir tickets o facturas de varios pedidos, del más antiguo al más nuevo"
          >
            <Receipt className="h-4 w-4 mr-2" /> Facturar
          </Button>
          {tiendaId && (
            <Button size="sm" onClick={() => setNuevoOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nuevo pedido
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, email o nº pedido…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          {!tiendaId && (
            <Select value={f.tienda} onValueChange={(tienda) => cambiar({ tienda })}>
              <SelectTrigger className="w-[170px] max-md:w-[calc(50%-0.25rem)]" aria-label="Tienda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las tiendas</SelectItem>
                {tiendasLista.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={estadoFiltro} onValueChange={(estado) => cambiar({ estado })}>
            <SelectTrigger className="w-[170px] max-md:w-[calc(50%-0.25rem)]" aria-label="Estado">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS.map((e) => (
                <SelectItem key={e} value={e}>
                  {ESTADO_LABEL[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cobrosDisponibles && (
            <Select value={f.cobro} onValueChange={(cobro) => cambiar({ cobro })}>
              <SelectTrigger className="w-[170px] max-md:w-[calc(50%-0.25rem)]" aria-label="Cobro">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Cobrado o no</SelectItem>
                <SelectItem value="pendiente">Con algo pendiente</SelectItem>
                <SelectItem value="parcial">Cobrado en parte</SelectItem>
                <SelectItem value="cobrado">Cobrado entero</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={f.origen} onValueChange={(origen) => cambiar({ origen })}>
            <SelectTrigger className="w-[150px] max-md:w-[calc(50%-0.25rem)]" aria-label="Origen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Web y manuales</SelectItem>
              <SelectItem value="web">Solo web</SelectItem>
              <SelectItem value="manual">Solo manuales</SelectItem>
            </SelectContent>
          </Select>
          {hay() && (
            <Button variant="ghost" size="sm" onClick={() => quitar()}>
              <X className="h-4 w-4 mr-1" /> Quitar filtros
            </Button>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {describirPedidos(totalesPeriodo.pedidos, totalesPeriodo.cancelados)} ·{" "}
            <span className="font-semibold text-foreground">{eur(totalesPeriodo.total)}</span>
          </div>
        </CardContent>
      </Card>

      {!cobrosDisponibles && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Los cobros de los pedidos necesitan la migración <code>20260929100000_cobros.sql</code>.
            Hasta que se aplique, no se pueden registrar.
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {isLoading && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Cargando pedidos…
            </CardContent>
          </Card>
        )}
        {!isLoading && grupos.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Sin pedidos en este periodo.
            </CardContent>
          </Card>
        )}
        {grupos.map((g) => (
          <div key={g.fecha}>
            <div className="flex items-center justify-between pb-2 border-b mb-2">
              <div className="text-sm font-semibold uppercase tracking-wider text-primary max-md:text-xs">
                {format(new Date(g.fecha), "EEEE, d 'DE' MMMM yyyy", { locale: es }).toUpperCase()}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{eur(g.totales.total)}</span>
                <Badge variant="outline" className="whitespace-nowrap">
                  {describirPedidos(g.totales.pedidos)}
                </Badge>
                {/* El importe no los suma: se dicen aparte para que el
                    número de pedidos cuadre con las filas que se ven. */}
                {g.totales.cancelados > 0 && (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    + {g.totales.cancelados}{" "}
                    {g.totales.cancelados === 1 ? "cancelado" : "cancelados"}
                  </span>
                )}
              </div>
            </div>
            {/* En el móvil, una tarjeta por pedido: una tabla de once columnas
                no cabe en 390 px y desplazarla de lado esconde lo importante. */}
            <div className="space-y-2 md:hidden">
              {g.lista.map((p) => {
                const abierta = expandida === p.id;
                return (
                  <TarjetaPedido
                    key={p.id}
                    pedido={p}
                    abierta={abierta}
                    mostrarTienda={!tiendaId}
                    onToggle={() => setExpandida(abierta ? null : p.id)}
                    onEstadoChange={(estado) => estadoMut.mutate({ id: p.id, estado })}
                    onEditar={() => setEditar(p)}
                    onTracking={() => setTracking(p)}
                    onBorrar={() => setBorrar(p)}
                    onFacturar={() => setFacturar(p)}
                    onCobros={cobrosDisponibles ? () => setCobrando(p) : undefined}
                  />
                );
              })}
            </div>
            <Card className="max-md:hidden">
              <CardContent className="p-0">
                {/*
                  Cada día es una tabla aparte, y una tabla HTML reparte el
                  ancho de sus columnas según SU propio contenido. Con anchos
                  automáticos, un grupo con nombres largos sacaba las columnas
                  de sitio respecto al grupo de al lado y las cabeceras no
                  cuadraban entre sí.

                  `table-fixed` hace que manden los anchos declarados abajo y
                  no el contenido, así que todos los grupos salen alineados.
                  Solo Cliente se queda sin ancho fijo: se lleva lo que sobre.
                  El `min-w` es para que en pantallas estrechas la tabla se
                  desplace en horizontal en vez de estrujar las columnas.

                  Ojo con la suma: los anchos fijos dan 912 px, así que a
                  Cliente le quedan al menos 168 y unos 220 en un portátil de
                  1440. Llegaron a sumar 1184, más que la propia tabla, y
                  Cliente se quedaba en cero: el nombre desaparecía y su
                  cabecera se montaba encima de la de Tienda. Por eso la tienda
                  va debajo del número y el método de pago debajo del total.
                  Si se añade una columna, que le quite el sitio a otra.

                  Estos anchos se repiten en ColumnasPedidos, para la tabla
                  del total del periodo: si cambian aquí, cambian allí.
                */}
                <Table className="table-fixed min-w-[1080px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="w-40">
                        {tiendaId ? "Nº Pedido" : "Nº Pedido · Tienda"}
                      </TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="w-32">Origen</TableHead>
                      <TableHead className="w-36">Estado</TableHead>
                      <TableHead className="w-28 text-right">Total</TableHead>
                      <TableHead className="w-28 text-right">Cobrado</TableHead>
                      <TableHead className="w-28 text-right">Pendiente</TableHead>
                      <TableHead className="w-14">Env.</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.lista.map((p) => {
                      const abierta = expandida === p.id;
                      return (
                        <FilaPedido
                          key={p.id}
                          pedido={p}
                          abierta={abierta}
                          mostrarTienda={!tiendaId}
                          onToggle={() => setExpandida(abierta ? null : p.id)}
                          onEstadoChange={(estado) => estadoMut.mutate({ id: p.id, estado })}
                          onEditar={() => setEditar(p)}
                          onTracking={() => setTracking(p)}
                          onBorrar={() => setBorrar(p)}
                          onFacturar={() => setFacturar(p)}
                          onCobros={cobrosDisponibles ? () => setCobrando(p) : undefined}
                        />
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <FilaTotales
                      titulo="Total del día"
                      totales={g.totales}
                      conCobros={cobrosDisponibles}
                    />
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          </div>
        ))}
        {!isLoading && grupos.length > 0 && (
          // El total de todos los días, en el ordenador y en el móvil (allí
          // los días son tarjetas sin pie: lo de cada día ya va en su cabecera).
          <Card>
            <CardContent className="p-0">
              {/*
                Una tabla con solo el pie, con las mismas columnas que la de
                cada día para que las cifras caigan debajo de las suyas. Con
                table-fixed los anchos los manda la primera fila, que aquí es
                el pie (con celdas juntas): por eso van en un <colgroup>.

                La cabecera está escondida: solo sirve para que, en el móvil,
                la tarjeta del pie diga «Total», «Cobrado» y «Pendiente»
                delante de cada cifra (las etiquetas salen de la cabecera).
              */}
              <Table movil="tarjetas" className="table-fixed min-w-[1080px]">
                <ColumnasPedidos />
                <TableHeader className="hidden">
                  <TableRow>
                    <TableHead />
                    <TableHead>Nº Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Cobrado</TableHead>
                    <TableHead>Pendiente</TableHead>
                    <TableHead>Env.</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableFooter className="border-t-0">
                  <FilaTotales
                    titulo="Total del periodo"
                    totales={totalesPeriodo}
                    conCobros={cobrosDisponibles}
                  />
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Suspense fallback={null}>
        {tiendaId && nuevoOpen && (
          <PedidoFormDialog
            open={nuevoOpen}
            onOpenChange={setNuevoOpen}
            tiendaId={tiendaId}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["pedidos"] })}
          />
        )}
        {editar && (
          <PedidoFormDialog
            open={!!editar}
            onOpenChange={(o) => !o && setEditar(null)}
            tiendaId={editar?.tienda_id ?? ""}
            pedido={editar ?? undefined}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["pedidos"] });
              setEditar(null);
            }}
          />
        )}
        {tracking && (
          <PedidoTrackingDialog
            open={!!tracking}
            onOpenChange={(o) => !o && setTracking(null)}
            pedido={tracking}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["pedidos"] });
              setTracking(null);
            }}
          />
        )}
        {facturar && (
          <FacturarPedidoDialog
            open={!!facturar}
            onOpenChange={(o) => !o && setFacturar(null)}
            pedidoId={facturar.id}
            numeroPedido={facturar.numero}
            onEmitida={() => {
              queryClient.invalidateQueries({ queryKey: ["pedidos"] });
              setFacturar(null);
            }}
          />
        )}
        {facturandoVarios && (
          <FacturarPedidosDialog
            open={facturandoVarios}
            onOpenChange={setFacturandoVarios}
            pedidoIds={sinDocumento.slice(0, 500).map((p) => p.id)}
            recortados={Math.max(0, sinDocumento.length - 500)}
            nombreTienda={
              tiendaId ? undefined : (id) => tiendasLista.find((t) => t.id === id)?.nombre ?? null
            }
          />
        )}
        {cobrando && (
          <CobrosPedidoDialog
            open={!!cobrando}
            onOpenChange={(o) => !o && setCobrando(null)}
            pedido={(() => {
              // La fila recién recargada, para que el diálogo vea los cobros
              // que se acaban de registrar o borrar.
              const p = pedidos.find((x) => x.id === cobrando.id) ?? cobrando;
              return {
                id: p.id,
                numero: p.numero,
                total: p.total,
                tipo: "tienda" as const,
                cancelado: p.estado === "cancelado",
                web: p.origen === "woocommerce",
              };
            })()}
            cobros={(pedidos.find((x) => x.id === cobrando.id) ?? cobrando).cobros ?? []}
          />
        )}
      </Suspense>
      <AlertDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar pedido {borrar?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán también las líneas asociadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => borrar && deleteMut.mutate(borrar.id)}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Los anchos de las diez columnas de la tabla de cada día (su cabecera, más
 * arriba), para la tabla del total del periodo, que no tiene cabecera
 * visible. Si cambian allí, tienen que cambiar aquí.
 */
function ColumnasPedidos() {
  return (
    <colgroup>
      <col className="w-10" />
      <col className="w-40" />
      <col />
      <col className="w-32" />
      <col className="w-36" />
      <col className="w-28" />
      <col className="w-28" />
      <col className="w-28" />
      <col className="w-14" />
      <col className="w-12" />
    </colgroup>
  );
}

/**
 * La fila de total de una lista de pedidos. Diez celdas, como la cabecera:
 * las cinco primeras juntas para el texto, Total, Cobrado y Pendiente en las
 * suyas, y dos vacías (envío y acciones). Con table-fixed, una de más o de
 * menos descuadra la tabla.
 */
function FilaTotales({
  titulo,
  totales,
  conCobros,
}: {
  titulo: string;
  totales: TotalesPedidos;
  /** Sin la migración de cobros, como en las filas: «—». */
  conCobros: boolean;
}) {
  return (
    <TableRow>
      <TableCell colSpan={5} className="font-semibold">
        {titulo} · {describirPedidos(totales.pedidos, totales.cancelados)}
      </TableCell>
      <TableCell className="text-right font-bold tabular-nums">{eur(totales.total)}</TableCell>
      <TableCell className="text-right font-bold tabular-nums">
        {conCobros ? eur(totales.cobrado) : "—"}
      </TableCell>
      <TableCell className="text-right font-bold tabular-nums">
        {conCobros ? eur(totales.pendiente) : "—"}
      </TableCell>
      <TableCell />
      <TableCell />
    </TableRow>
  );
}

type PropsPedido = {
  pedido: PedidoFila;
  abierta: boolean;
  mostrarTienda: boolean;
  onToggle: () => void;
  onEstadoChange: (estado: string) => void;
  onEditar: () => void;
  onTracking: () => void;
  onBorrar: () => void;
  onFacturar: () => void;
  /** Sin él, la migración de cobros no está aplicada y no se ofrece. */
  onCobros?: () => void;
};

// El número que ve el cliente, siempre. Antes esta línea era al revés: si
// el pedido venía de WooCommerce se pintaba `#` + el id interno de
// WordPress, tirando a la basura el `numero` que la sincronización ya
// guardaba bien. Con un plugin de numeración eso enseñaba #432 donde el
// cliente tiene DCUL-23-2026, y al llamar preguntando por su pedido no
// había forma de encontrarlo.
//
// El id solo se usa si no hay número, que es lo único que puede pasarle a
// un pedido importado antes de que existiera esa columna.
function numeroVisible(pedido: PedidoFila) {
  return pedido.numero?.trim() || (pedido.woo_order_id ? `#${pedido.woo_order_id}` : "—");
}

/**
 * El ticket o la factura del pedido, en verde, con su número: abre el PDF.
 * Es el mismo PDF que se descarga desde Facturas (si no estaba guardado, el
 * servidor lo genera y lo guarda antes).
 */
function BotonDocumento({ documento }: { documento: DocumentoDeLista }) {
  const abrirFn = useServerFn(generarYSubirFacturaPDF);
  const [abriendo, setAbriendo] = useState(false);
  const esTicket = documento.tipo === "simplificada";
  const que = `${esTicket ? "el ticket" : "la factura"} ${documento.referencia}`;
  const Icono = esTicket ? Receipt : FileText;

  async function abrir() {
    // La pestaña se abre ya, con el clic: al volver de la red el navegador
    // no deja abrir ventanas.
    const ventana = window.open("", "_blank");
    setAbriendo(true);
    try {
      const r = await abrirFn({ data: { factura_id: documento.id } });
      if (!r?.url) throw new Error("No se pudo abrir el PDF");
      if (ventana) ventana.location.href = r.url;
      else window.location.href = r.url;
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo abrir el PDF");
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={abriendo}
      title={`Abrir ${que}`}
      aria-label={`Abrir ${que}`}
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md border border-status-completado/30 bg-status-completado/15 px-1.5 py-0.5 text-xs font-medium text-status-completado transition-colors hover:bg-status-completado/25 disabled:opacity-60 max-md:mt-0"
    >
      {abriendo ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Icono className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate font-mono">{documento.referencia}</span>
    </button>
  );
}

function FilaPedido({
  pedido,
  abierta,
  mostrarTienda,
  onToggle,
  onEstadoChange,
  onEditar,
  onTracking,
  onBorrar,
  onFacturar,
  onCobros,
}: PropsPedido) {
  const origenLabel = pedido.origen === "woocommerce" ? "WooCommerce" : "Manual";
  const numeroLabel = numeroVisible(pedido);
  const cancelado = pedido.estado === "cancelado";
  const cobro = resumenCobros(pedido.total, pedido.cobros ?? []);

  return (
    <>
      <TableRow>
        <TableCell className="cursor-pointer" onClick={onToggle}>
          {abierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </TableCell>
        <TableCell>
          <div className="font-mono text-sm truncate">{numeroLabel}</div>
          {mostrarTienda && (
            <div
              className="text-xs text-muted-foreground truncate"
              title={pedido.tienda_nombre ?? undefined}
            >
              {pedido.tienda_nombre ?? "—"}
            </div>
          )}
          {pedido.documento && <BotonDocumento documento={pedido.documento} />}
        </TableCell>
        <TableCell>
          {/* Con table-fixed la celda ya no se estira: un correo largo se
              recorta con puntos suspensivos en vez de descuadrar la fila.
              El title deja verlo entero al pasar el ratón. */}
          <div className="font-medium truncate" title={pedido.cliente_nombre ?? undefined}>
            {pedido.cliente_nombre ?? "—"}
          </div>
          {pedido.cliente_email && (
            <div className="text-xs text-muted-foreground truncate" title={pedido.cliente_email}>
              {pedido.cliente_email}
            </div>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={pedido.origen === "woocommerce" ? "default" : "outline"}>
            {origenLabel}
          </Badge>
        </TableCell>
        <TableCell>
          {/* Se ve como el Origen, una etiqueta y ya. Sigue cambiándose: la
              etiqueta abre el menú. Un desplegable por fila llenaba la tabla
              de cajas y hacía difícil leer la columna de un vistazo. */}
          <SelectorEstado estado={pedido.estado} onEstadoChange={onEstadoChange} />
        </TableCell>
        <TableCell className="text-right">
          <div className="font-semibold">{eur(pedido.total)}</div>
          {pedido.metodo_pago && (
            <div className="text-xs text-muted-foreground truncate" title={pedido.metodo_pago}>
              {pedido.metodo_pago}
            </div>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {onCobros ? eur(cobro.cobrado) : "—"}
        </TableCell>
        <TableCell className="text-right">
          {!onCobros || cancelado ? (
            "—"
          ) : (
            // Abre los cobros: es lo que se quiere hacer al mirar lo pendiente.
            <button
              type="button"
              className="text-right hover:underline"
              title="Ver y registrar cobros"
              onClick={onCobros}
            >
              <span className="block tabular-nums font-medium">
                {eur(Math.max(cobro.pendiente, 0))}
              </span>
              <EstadoCobroTexto estado={cobro.estado} />
            </button>
          )}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={
              pedido.tracking?.codigo_seguimiento
                ? `Tracking: ${pedido.tracking.codigo_seguimiento}`
                : "Añadir tracking del envío"
            }
            onClick={onTracking}
          >
            <Truck
              className={`h-4 w-4 ${pedido.tracking?.codigo_seguimiento ? "text-primary" : "text-muted-foreground"}`}
            />
          </Button>
        </TableCell>
        <TableCell>
          <MenuAcciones
            onEditar={onEditar}
            onTracking={onTracking}
            onCobros={onCobros}
            onFacturar={onFacturar}
            onBorrar={onBorrar}
          />
        </TableCell>
      </TableRow>
      {abierta && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={9}>
            <DetallePedido pedido={pedido} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * El mismo pedido que FilaPedido, en tarjeta, para el móvil. Arriba lo que se
 * busca de un vistazo (número, cliente, total); debajo el estado y lo que
 * queda por cobrar, que es lo que se toca; el resto al desplegar.
 */
function TarjetaPedido({
  pedido,
  abierta,
  mostrarTienda,
  onToggle,
  onEstadoChange,
  onEditar,
  onTracking,
  onBorrar,
  onFacturar,
  onCobros,
}: PropsPedido) {
  const cancelado = pedido.estado === "cancelado";
  const cobro = resumenCobros(pedido.total, pedido.cobros ?? []);
  const conTracking = !!pedido.tracking?.codigo_seguimiento;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="flex-1 min-w-0 text-left"
            onClick={onToggle}
            aria-expanded={abierta}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{numeroVisible(pedido)}</span>
              {mostrarTienda && pedido.tienda_nombre && (
                <span className="truncate">· {pedido.tienda_nombre}</span>
              )}
            </div>
            <div className="font-medium truncate">{pedido.cliente_nombre ?? "—"}</div>
            {pedido.cliente_email && (
              <div className="text-xs text-muted-foreground truncate">{pedido.cliente_email}</div>
            )}
          </button>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">{eur(pedido.total)}</div>
            <div className="text-xs text-muted-foreground">{pedido.metodo_pago ?? ""}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SelectorEstado estado={pedido.estado} onEstadoChange={onEstadoChange} />
          <Badge variant={pedido.origen === "woocommerce" ? "default" : "outline"}>
            {pedido.origen === "woocommerce" ? "WooCommerce" : "Manual"}
          </Badge>
          {pedido.documento && <BotonDocumento documento={pedido.documento} />}
          {onCobros && !cancelado && (
            <button
              type="button"
              className="ml-auto text-right text-sm"
              title="Ver y registrar cobros"
              onClick={onCobros}
            >
              <span className="tabular-nums font-medium">{eur(Math.max(cobro.pendiente, 0))}</span>{" "}
              <EstadoCobroTexto estado={cobro.estado} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 border-t pt-2 -mb-1">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onToggle}>
            {abierta ? (
              <ChevronUp className="h-4 w-4 mr-1" />
            ) : (
              <ChevronDown className="h-4 w-4 mr-1" />
            )}
            {abierta ? "Ocultar" : "Detalle"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 ml-auto"
            onClick={onTracking}
            aria-label={conTracking ? "Ver tracking del envío" : "Añadir tracking del envío"}
          >
            <Truck
              className={`h-4 w-4 ${conTracking ? "text-primary" : "text-muted-foreground"}`}
            />
          </Button>
          <MenuAcciones
            onEditar={onEditar}
            onTracking={onTracking}
            onCobros={onCobros}
            onFacturar={onFacturar}
            onBorrar={onBorrar}
          />
        </div>

        {abierta && (
          <div className="rounded-md bg-muted/30 px-2">
            <DetallePedido pedido={pedido} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectorEstado({
  estado,
  onEstadoChange,
}: {
  estado: string;
  onEstadoChange: (estado: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Cambiar el estado">
          <Badge variant={estadoVariant(estado)} className="cursor-pointer hover:opacity-80">
            {ESTADO_LABEL[estado] ?? estado}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ESTADOS.map((e) => (
          <DropdownMenuItem key={e} onClick={() => onEstadoChange(e)}>
            <Badge variant={estadoVariant(e)} className="mr-2">
              {ESTADO_LABEL[e]}
            </Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuAcciones({
  onEditar,
  onTracking,
  onCobros,
  onFacturar,
  onBorrar,
}: {
  onEditar: () => void;
  onTracking: () => void;
  onCobros?: () => void;
  onFacturar: () => void;
  onBorrar: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEditar}>Editar</DropdownMenuItem>
        <DropdownMenuItem onClick={onTracking}>Tracking</DropdownMenuItem>
        {onCobros && <DropdownMenuItem onClick={onCobros}>Cobros</DropdownMenuItem>}
        <DropdownMenuItem onClick={onFacturar}>Ticket o factura</DropdownMenuItem>
        <DropdownMenuItem onClick={onBorrar} className="text-destructive">
          Borrar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Lo que se ve al desplegar un pedido: líneas, totales, cliente y envío. */
function DetallePedido({ pedido }: { pedido: PedidoFila }) {
  return (
    <div className="py-2 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Líneas del pedido
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">Subtotal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pedido.items.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.descripcion}</TableCell>
              <TableCell className="text-right">
                <CantidadLinea linea={l} />
              </TableCell>
              <TableCell className="text-right">{eur(l.precio_unitario)}</TableCell>
              <TableCell className="text-right font-medium">{eur(l.subtotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid grid-cols-4 gap-4 pt-2 text-sm max-md:grid-cols-2 max-md:gap-2">
        <div>
          <span className="text-muted-foreground">Subtotal:</span>{" "}
          <span className="font-medium">{eur(pedido.subtotal)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">IVA:</span>{" "}
          <span className="font-medium">{eur(pedido.iva)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Envío:</span>{" "}
          <span className="font-medium">{eur(pedido.envio)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Total:</span>{" "}
          <span className="font-semibold">{eur(pedido.total)}</span>
        </div>
      </div>
      <DatosDelCliente pedido={pedido} />

      {pedido.tracking?.codigo_seguimiento && (
        <div className="text-xs text-muted-foreground">
          Envío: {pedido.tracking.transportista} ·{" "}
          <span className="font-mono">{pedido.tracking.codigo_seguimiento}</span>
          {pedido.tracking.url && (
            <>
              {" · "}
              <a href={pedido.tracking.url} target="_blank" rel="noreferrer" className="underline">
                Seguir envío
              </a>
            </>
          )}
        </div>
      )}
      {pedido.notas && <div className="text-xs text-muted-foreground">Notas: {pedido.notas}</div>}
    </div>
  );
}

/**
 * Quién ha pedido y adónde va.
 *
 * Las direcciones vienen congeladas en el pedido, no de la ficha del cliente:
 * si el cliente se muda, el pedido antiguo se envió a la casa antigua y la
 * etiqueta que se imprimió decía eso.
 */
function DatosDelCliente({ pedido }: { pedido: PedidoFila }) {
  const facturacion = pedido.direccion_facturacion;
  const envio = pedido.direccion_envio;
  const esLaMisma = sonLaMismaDireccion(envio, facturacion);

  return (
    <div className="grid gap-4 pt-3 border-t md:grid-cols-3 text-sm">
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Cliente
        </div>
        <div className="font-medium">{pedido.cliente_nombre ?? "—"}</div>
        {pedido.cliente_email && (
          <div className="text-muted-foreground">{pedido.cliente_email}</div>
        )}
        {pedido.cliente_telefono && (
          <div className="text-muted-foreground">{pedido.cliente_telefono}</div>
        )}
      </div>

      <BloqueDireccion titulo="Facturación" direccion={facturacion} />
      <BloqueDireccion
        titulo="Envío"
        direccion={envio}
        nota={esLaMisma ? "La misma que la de facturación" : null}
      />
    </div>
  );
}

function BloqueDireccion({
  titulo,
  direccion,
  nota,
}: {
  titulo: string;
  direccion: Direccion | null;
  nota?: string | null;
}) {
  const filas = direccion ? lineasDireccion(direccion) : [];
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {titulo}
      </div>
      {filas.length === 0 ? (
        // Sin inventar nada: un pedido manual no trae direcciones y decirlo es
        // más útil que dejar el hueco en blanco.
        <div className="text-muted-foreground">Sin dirección en el pedido</div>
      ) : (
        filas.map((l, i) => (
          <div key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
            {l}
          </div>
        ))
      )}
      {nota && filas.length > 0 && <div className="text-xs text-muted-foreground mt-1">{nota}</div>}
    </div>
  );
}

/**
 * La cantidad de una línea. Si los metros son estimados (importe ÷ precio por
 * metro, porque WooCommerce no trajo la longitud del montador), se dice.
 */
function CantidadLinea({ linea }: { linea: PedidoFila["items"][number] }) {
  const cantidad = Number(linea.cantidad);
  if (linea.unidad !== "m") {
    return <>{`${numero(cantidad, Number.isInteger(cantidad) ? 0 : 2)} ${linea.unidad}`}</>;
  }
  if (!esEstimado(linea.metros_origen)) return <>{metros(cantidad)}</>;
  const precio = Number(linea.precio_metro_usado);
  return (
    <span
      title={`Estimado: ${eur(Number(linea.subtotal))} ÷ ${eur(precio)}/m. WooCommerce no trajo la longitud del montador.`}
    >
      ≈ {metros(cantidad)}
      <span className="block text-xs text-muted-foreground">estimado</span>
    </span>
  );
}
