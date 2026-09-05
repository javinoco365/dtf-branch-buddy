import { lazy, Suspense, useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { eur } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import {
  lineasDireccion,
  mismaDireccion as sonLaMismaDireccion,
  type Direccion,
} from "@/dominio/direcciones";
import { deletePedido, listPedidos, updatePedidoEstado } from "@/lib/pedidos.functions";
import { sincronizarWoo } from "@/lib/woocommerce.functions";
const PedidoFormDialog = lazy(() =>
  import("@/components/PedidoFormDialog").then((m) => ({ default: m.PedidoFormDialog })),
);
const PedidoTrackingDialog = lazy(() =>
  import("@/components/PedidoTrackingDialog").then((m) => ({ default: m.PedidoTrackingDialog })),
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

type Periodo = "mes" | "semana";

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
  }[];
  tracking: {
    id: string;
    transportista: string | null;
    codigo_seguimiento: string | null;
    url: string | null;
  } | null;
};

function rango(ref: Date, p: Periodo) {
  return p === "mes"
    ? { desde: startOfMonth(ref), hasta: endOfMonth(ref) }
    : { desde: startOfWeek(ref, { weekStartsOn: 1 }), hasta: endOfWeek(ref, { weekStartsOn: 1 }) };
}

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

function estadoVariant(estado: string): "default" | "secondary" | "destructive" | "outline" {
  if (estado === "entregado") return "default";
  if (estado === "cancelado") return "destructive";
  if (estado === "pendiente") return "outline";
  return "secondary";
}

export function PedidosTable({ tiendaId }: { tiendaId?: string }) {
  const queryClient = useQueryClient();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<string>("todos");
  const [expandida, setExpandida] = useState<string | null>(null);

  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editar, setEditar] = useState<PedidoFila | null>(null);
  const [tracking, setTracking] = useState<PedidoFila | null>(null);
  const [borrar, setBorrar] = useState<PedidoFila | null>(null);

  const { desde, hasta } = rango(ref, periodo);
  const list = useServerFn(listPedidos);
  const sincronizarFn = useServerFn(sincronizarWoo);
  const sincronizar = useMutation({
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

  const setEstadoFn = useServerFn(updatePedidoEstado);
  const delFn = useServerFn(deletePedido);

  const queryKey = ["pedidos", tiendaId ?? "all", desde.toISOString(), hasta.toISOString()];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      list({
        data: { tiendaId, desde: desde.toISOString(), hasta: hasta.toISOString() },
      }),
  });

  const pedidos: PedidoFila[] = (data?.pedidos ?? []) as any;

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
    const q = busqueda.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (estadoFiltro !== "todos" && p.estado !== estadoFiltro) return false;
      if (!q) return true;
      return (
        (p.cliente_nombre ?? "").toLowerCase().includes(q) ||
        (p.cliente_email ?? "").toLowerCase().includes(q) ||
        p.numero.toLowerCase().includes(q)
      );
    });
  }, [pedidos, busqueda, estadoFiltro]);

  // Agrupar por día
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
        total: lista.reduce((s, p) => s + Number(p.total), 0),
      }));
  }, [filtrados]);

  const tituloPeriodo =
    periodo === "mes"
      ? format(ref, "MMMM yyyy", { locale: es })
      : `Semana ${format(desde, "d MMM", { locale: es })} – ${format(hasta, "d MMM yyyy", { locale: es })}`;

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Nº", "Tienda", "Cliente", "Email", "Estado", "Origen", "Pago", "Total"],
      ...filtrados.map((p) => [
        format(new Date(p.fecha_pedido), "yyyy-MM-dd"),
        p.numero,
        p.tienda_nombre ?? "",
        p.cliente_nombre ?? "",
        p.cliente_email ?? "",
        ESTADO_LABEL[p.estado] ?? p.estado,
        p.origen ?? "",
        p.metodo_pago ?? "",
        p.total,
      ]),
    ];
    descargarCSV(`pedidos-${format(desde, "yyyy-MM-dd")}.csv`, filas);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-card overflow-hidden">
          <Button
            variant={periodo === "mes" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setPeriodo("mes")}
          >
            Mes
          </Button>
          <Button
            variant={periodo === "semana" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setPeriodo("semana")}
          >
            Semana
          </Button>
        </div>
        <div className="inline-flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRef(periodo === "mes" ? addMonths(ref, -1) : addWeeks(ref, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center text-sm font-medium capitalize">
            {tituloPeriodo}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRef(periodo === "mes" ? addMonths(ref, 1) : addWeeks(ref, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRef(new Date())}>
            Hoy
          </Button>
        </div>
        <div className="ml-auto flex gap-2">
          {/* Solo con una tienda delante: sincronizar «todas» no significa
              nada, cada una tiene sus credenciales y su web. */}
          {tiendaId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => sincronizar.mutate()}
              disabled={sincronizar.isPending}
            >
              {sincronizar.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {sincronizar.isPending ? "Sincronizando…" : "Sincronizar ahora"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download className="h-4 w-4 mr-2" /> Exportar CSV
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
          <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
            <SelectTrigger className="w-[180px]">
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
          <div className="text-xs text-muted-foreground ml-auto">
            {filtrados.length} pedidos ·{" "}
            <span className="font-semibold text-foreground">
              {eur(filtrados.reduce((s, p) => s + Number(p.total), 0))}
            </span>
          </div>
        </CardContent>
      </Card>

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
              <div className="text-sm font-semibold uppercase tracking-wider text-primary">
                {format(new Date(g.fecha), "EEEE, d 'DE' MMMM yyyy", { locale: es }).toUpperCase()}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{eur(g.total)}</span>
                <Badge variant="outline">
                  {g.lista.length} {g.lista.length === 1 ? "pedido" : "pedidos"}
                </Badge>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Nº Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      {!tiendaId && <TableHead>Tienda</TableHead>}
                      <TableHead>Origen</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Pago</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-10">Env.</TableHead>
                      <TableHead className="w-10" />
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
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ))}
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

function FilaPedido({
  pedido,
  abierta,
  mostrarTienda,
  onToggle,
  onEstadoChange,
  onEditar,
  onTracking,
  onBorrar,
}: {
  pedido: PedidoFila;
  abierta: boolean;
  mostrarTienda: boolean;
  onToggle: () => void;
  onEstadoChange: (estado: string) => void;
  onEditar: () => void;
  onTracking: () => void;
  onBorrar: () => void;
}) {
  const origenLabel = pedido.origen === "woocommerce" ? "WooCommerce" : "Manual";
  const numeroLabel = pedido.woo_order_id ? `#${pedido.woo_order_id}` : pedido.numero;

  return (
    <>
      <TableRow>
        <TableCell className="cursor-pointer" onClick={onToggle}>
          {abierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-sm">{numeroLabel}</TableCell>
        <TableCell>
          <div className="font-medium">{pedido.cliente_nombre ?? "—"}</div>
          {pedido.cliente_email && (
            <div className="text-xs text-muted-foreground">{pedido.cliente_email}</div>
          )}
        </TableCell>
        {mostrarTienda && (
          <TableCell className="text-xs text-muted-foreground">
            {pedido.tienda_nombre ?? "—"}
          </TableCell>
        )}
        <TableCell>
          <Badge variant={pedido.origen === "woocommerce" ? "default" : "outline"}>
            {origenLabel}
          </Badge>
        </TableCell>
        <TableCell>
          {/* Se ve como el Origen, una etiqueta y ya. Sigue cambiándose: la
              etiqueta abre el menú. Un desplegable por fila llenaba la tabla
              de cajas y hacía difícil leer la columna de un vistazo. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Cambiar el estado">
                <Badge
                  variant={estadoVariant(pedido.estado)}
                  className="cursor-pointer hover:opacity-80"
                >
                  {ESTADO_LABEL[pedido.estado] ?? pedido.estado}
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
        </TableCell>
        <TableCell className="text-xs text-muted-foreground max-w-[140px]">
          {pedido.metodo_pago ?? "—"}
        </TableCell>
        <TableCell className="text-right font-semibold">{eur(pedido.total)}</TableCell>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditar}>Editar</DropdownMenuItem>
              <DropdownMenuItem onClick={onTracking}>Tracking</DropdownMenuItem>
              <DropdownMenuItem onClick={onBorrar} className="text-destructive">
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {abierta && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={mostrarTienda ? 9 : 8}>
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
                        {l.cantidad} {l.unidad}
                      </TableCell>
                      <TableCell className="text-right">{eur(l.precio_unitario)}</TableCell>
                      <TableCell className="text-right font-medium">{eur(l.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid grid-cols-4 gap-4 pt-2 text-sm">
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
                      <a
                        href={pedido.tracking.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        Seguir envío
                      </a>
                    </>
                  )}
                </div>
              )}
              {pedido.notas && (
                <div className="text-xs text-muted-foreground">Notas: {pedido.notas}</div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
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
