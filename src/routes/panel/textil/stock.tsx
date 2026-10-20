import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useFiltrosUrl } from "@/lib/filtros-url";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";
import { normalizarTexto } from "@/dominio/clientes";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  GitMerge,
  History,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  listStock,
  upsertStockItem,
  deleteStockItem,
  registrarMovimientoStock,
  listMovimientosStock,
} from "@/lib/textil.functions";
import { listCompras } from "@/lib/compras.functions";
import {
  estadoEscanerTextil,
  fusionarVariantes,
  guardarProductoTextil,
  listProductosTextil,
} from "@/lib/escaner-textil.functions";
import { AVISO_MIGRACION_ESCANER } from "@/lib/escaner-textil";
import { toast } from "sonner";
import { eur as fmtEUR, eurConSigno, eurUnitario, numero } from "@/lib/format";
import { comprasParaDevolucion } from "@/dominio/proformas";
import {
  EXPLICACION_VALOR_STOCK,
  totalesMovimientosStock,
  totalesStock,
} from "@/dominio/sumatorios-textil";
import { aVarianteCatalogo, etiquetaVariante, utilizable } from "@/dominio/stock-textil";
import { claveTalla, claveTexto, eanValido } from "@/dominio/normalizar-textil";
import { precioRecomendado } from "@/dominio/precio-recomendado";
import type { ProductoTextil, VarianteCatalogo } from "@/dominio/tipos-textil";
import { TextoRecomendado } from "@/components/textil/CrearVarianteDialog";

export const Route = createFileRoute("/panel/textil/stock")({
  head: () => ({ meta: [{ title: "Stock textil · DTF Culture" }] }),
  component: StockPage,
});

type Item = any;

/** «Gildan · 5000», o «—» sin producto. */
const textoProducto = (v: VarianteCatalogo) =>
  [v.producto?.marca, v.producto?.referencia].filter(Boolean).join(" · ") ||
  v.producto?.nombre ||
  "—";

function StockPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listStock);
  const upsertFn = useServerFn(upsertStockItem);
  const delFn = useServerFn(deleteStockItem);
  const { data = [], isLoading } = useQuery({
    queryKey: ["textil-stock"],
    queryFn: () => listFn(),
  });
  // Con la migración del escáner: productos, EAN, repetidas y fusión.
  const estadoFn = useServerFn(estadoEscanerTextil);
  const { data: estadoEscaner } = useQuery({
    queryKey: ["escaner-textil-estado"],
    queryFn: () => estadoFn(),
  });
  const escaner = estadoEscaner?.aplicada === true;
  const variantes = useMemo(
    () => (data as Record<string, unknown>[]).map(aVarianteCatalogo),
    [data],
  );
  const porId = useMemo(() => new Map(variantes.map((v) => [v.id, v])), [variantes]);
  // Los filtros viven en la dirección.
  const { valores: filtros, cambiar, quitar, hay } = useFiltrosUrl({ q: "", bajo: false });
  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (data as any[]).filter((it) => {
      // «Poco stock» mira lo disponible, como el aviso de la tabla.
      const disponible = Number(it.cantidad) - Number(it.cantidad_reservada ?? 0);
      if (filtros.bajo && disponible > Number(it.cantidad_minima)) return false;
      const v = porId.get(it.id);
      return (
        !q ||
        [
          it.sku,
          it.nombre,
          it.categoria,
          it.color,
          it.talla,
          it.ean,
          v?.producto?.marca,
          v?.producto?.referencia,
        ].some((x) => normalizarTexto(x).includes(q))
      );
    });
  }, [data, porId, filtros.q, filtros.bajo]);
  // El pie suma las mismas variantes que se ven, desactivadas incluidas.
  const totales = useMemo(() => totalesStock(filtrados), [filtrados]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [otro, setOtro] = useState<Item | null>(null);
  const [recuento, setRecuento] = useState<Item | null>(null);
  const [historial, setHistorial] = useState<Item | null>(null);
  const [fusionando, setFusionando] = useState<VarianteCatalogo | null>(null);
  // Variantes marcadas para crear un presupuesto o un pedido con ellas.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const marcar = (id: string, si: boolean) =>
    setMarcadas((m) => {
      const s = new Set(m);
      if (si) s.add(id);
      else s.delete(id);
      return s;
    });
  const crearDesdeStock = (destino: "/panel/textil/presupuestos" | "/panel/textil/pedidos") =>
    void navigate({ to: destino, search: { desde_stock: [...marcadas].join(",") } });

  const movimientoFn = useServerFn(registrarMovimientoStock);
  const movimiento = useMutation({
    mutationFn: (d: any) => movimientoFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["stock-movimientos"] });
      toast.success("Movimiento anotado");
      setOtro(null);
      setRecuento(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const productoFn = useServerFn(guardarProductoTextil);
  // El producto nuevo que ya se creó en un intento anterior cuya variante
  // falló (un EAN repetido, por ejemplo): el reintento lo reutiliza en vez de
  // volver a crearlo y chocar con «Ya existe un producto con esa marca…».
  const productoCreado = useRef<{ clave: string; id: string } | null>(null);
  const upsert = useMutation({
    mutationFn: async (d: { variante: any; productoNuevo: ProductoNuevo | null }) => {
      let producto_id: string | null | undefined = d.variante.producto_id;
      // El producto nuevo se guarda antes que la variante, que apunta a él.
      if (d.productoNuevo) {
        const clave = JSON.stringify(d.productoNuevo);
        if (productoCreado.current?.clave === clave) {
          producto_id = productoCreado.current.id;
        } else {
          const r = await productoFn({ data: d.productoNuevo });
          producto_id = r.id;
          productoCreado.current = { clave, id: r.id };
        }
      }
      return upsertFn({
        data: { ...d.variante, ...(producto_id !== undefined ? { producto_id } : {}) },
      });
    },
    onSuccess: () => {
      productoCreado.current = null;
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["textil-productos"] });
      toast.success("Guardado");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => {
      // Si el producto llegó a crearse, que ya salga en el desplegable.
      qc.invalidateQueries({ queryKey: ["textil-productos"] });
      toast.error(e.message);
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      // Una variante con movimientos no se borra: su historia explica el coste
      // de lo que ya vendiste. Se desactiva, y aquí se dice.
      toast.success(
        r?.resultado === "desactivada"
          ? "La variante tiene movimientos, así que se ha desactivado en vez de borrarla"
          : "Variante eliminada",
      );
    },
    onError: (e: any) => toast.error(e.message),
  });
  const fusionarFn = useServerFn(fusionarVariantes);
  const fusionar = useMutation({
    mutationFn: (d: { origen: string; destino: string }) => fusionarFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["stock-movimientos"] });
      toast.success("Variantes fusionadas: las existencias y el historial pasan a la buena");
      setFusionando(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const columnas = escaner ? 15 : 13;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Stock textil</h1>
          <p className="text-sm text-muted-foreground">
            Inventario de camisetas, sudaderas y demás prendas.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuevo artículo
        </Button>
      </div>
      {estadoEscaner && !escaner && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p>{AVISO_MIGRACION_ESCANER}</p>
          </CardContent>
        </Card>
      )}
      <BarraFiltros>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => cambiar({ q })}
          placeholder={
            escaner
              ? "Buscar SKU, nombre, marca, referencia, color, talla o EAN…"
              : "Buscar SKU, nombre, categoría, color o talla…"
          }
        />
        <SelectFiltro
          etiqueta="Existencias"
          valor={filtros.bajo ? "bajo" : "todo"}
          alCambiar={(v) => cambiar({ bajo: v === "bajo" })}
          opciones={[
            { valor: "todo", etiqueta: "Todo el stock" },
            { valor: "bajo", etiqueta: "Solo poco stock" },
          ]}
        />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>
      {marcadas.size > 0 && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="font-medium mr-auto">
              {marcadas.size} variante{marcadas.size === 1 ? "" : "s"}
            </span>
            <Button size="sm" onClick={() => crearDesdeStock("/panel/textil/presupuestos")}>
              Crear presupuesto
            </Button>
            <Button size="sm" onClick={() => crearDesdeStock("/panel/textil/pedidos")}>
              Crear pedido
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMarcadas(new Set())}>
              Quitar selección
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" aria-label="Elegir" />
                <TableHead>SKU</TableHead>
                {escaner && <TableHead>Producto</TableHead>}
                <TableHead>Nombre</TableHead>
                <TableHead>Cat.</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Talla</TableHead>
                {escaner && <TableHead>EAN</TableHead>}
                <TableHead className="text-right" title="Lo que hay si vas y lo cuentas">
                  Físico
                </TableHead>
                <TableHead className="text-right" title="Comprometido en pedidos sin entregar">
                  Reservado
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Físico menos reservado: lo que puedes prometer"
                >
                  Disponible
                </TableHead>
                <TableHead className="text-right">Mín.</TableHead>
                <TableHead className="text-right">Coste</TableHead>
                <TableHead className="text-right">PVP</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={columnas}>Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnas} className="text-center text-muted-foreground py-8">
                    Sin artículos.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((it: any) => {
                const v = porId.get(it.id);
                const reservado = Number(it.cantidad_reservada ?? 0);
                const disponible = Number(it.cantidad) - reservado;
                // El aviso mira lo disponible, no lo físico: tener 20 en el
                // armario con 18 comprometidos no es tener 20 para vender.
                const bajo = disponible <= Number(it.cantidad_minima);
                const vendible = !!v && utilizable(v);
                return (
                  <TableRow key={it.id}>
                    <TableCell>
                      <Checkbox
                        aria-label="Elegir para un presupuesto o un pedido"
                        disabled={!vendible}
                        checked={marcadas.has(it.id)}
                        onCheckedChange={(c) => marcar(it.id, c === true)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.sku ?? "—"}</TableCell>
                    {escaner && <TableCell>{v ? textoProducto(v) : "—"}</TableCell>}
                    <TableCell className="font-medium">
                      {it.nombre}
                      {escaner && v?.repetida && (
                        <Badge variant="outline" className="ml-2 border-amber-500 text-amber-700">
                          Repetida
                        </Badge>
                      )}
                      {v && !v.activa && (
                        <Badge variant="outline" className="ml-2 text-muted-foreground">
                          Desactivada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{it.categoria ?? "—"}</TableCell>
                    <TableCell>{it.color ?? "—"}</TableCell>
                    <TableCell>{it.talla ?? "—"}</TableCell>
                    {escaner && (
                      <TableCell className="font-mono text-xs">{it.ean ?? "—"}</TableCell>
                    )}
                    <TableCell className="text-right">{it.cantidad}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {reservado || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {bajo ? <Badge variant="destructive">{disponible}</Badge> : disponible}
                    </TableCell>
                    <TableCell className="text-right">{it.cantidad_minima}</TableCell>
                    <TableCell className="text-right">
                      {fmtEUR(Number(it.coste_unitario))}
                    </TableCell>
                    <TableCell className="text-right">{fmtEUR(Number(it.precio_venta))}</TableCell>
                    <TableCell className="text-right">
                      {escaner && v?.repetida && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Fusionar con…"
                          aria-label="Fusionar con…"
                          onClick={() => setFusionando(v)}
                        >
                          <GitMerge className="h-4 w-4 text-amber-600" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Otro movimiento: merma, devolución o ajuste"
                        aria-label="Otro movimiento"
                        onClick={() => setOtro(it)}
                      >
                        <ArrowLeftRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Recuento físico"
                        onClick={() => setRecuento(it)}
                      >
                        <ClipboardCheck className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Historial de movimientos"
                        onClick={() => setHistorial(it)}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar datos"
                        onClick={() => {
                          setEditing(it);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (
                            confirm(
                              `¿Seguro que quieres eliminar "${it.nombre}"?\n\n` +
                                "Si tiene movimientos de stock no se borrará: se desactivará, " +
                                "porque su historia explica el coste de lo que ya vendiste." +
                                // Con la migración del escáner, solo a 0 unidades.
                                (escaner && Number(it.cantidad) !== 0
                                  ? "\n\nTodavía tiene unidades: para retirarla, antes anota una " +
                                    "merma o un recuento que la deje a 0, o fusiónala con la buena."
                                  : ""),
                            )
                          )
                            del.mutate(it.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {!isLoading && filtrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={escaner ? 8 : 6}>
                    Total · {totales.variantes} variante{totales.variantes === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {numero(totales.fisico, 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {numero(totales.reservado, 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {numero(totales.disponible, 0)}
                  </TableCell>
                  <TableCell />
                  {/* El coste es por unidad y no se suma: aquí va lo que vale el stock a coste. */}
                  <TableCell
                    className="text-right font-bold tabular-nums"
                    title={EXPLICACION_VALOR_STOCK}
                    data-etiqueta-fija="Valor del stock"
                  >
                    {fmtEUR(totales.valor)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {open && (
        <StockDialog
          onOpenChange={setOpen}
          item={editing}
          escaner={escaner}
          catalogo={variantes}
          onSave={(v) => upsert.mutate(v)}
          loading={upsert.isPending}
        />
      )}

      {otro && (
        <OtroMovimientoDialog
          item={otro}
          escaner={escaner}
          onClose={() => setOtro(null)}
          onSave={(v: any) => movimiento.mutate(v)}
          loading={movimiento.isPending}
        />
      )}

      <RecuentoDialog
        item={recuento}
        onClose={() => setRecuento(null)}
        onSave={(v: any) => movimiento.mutate(v)}
        loading={movimiento.isPending}
      />

      {fusionando && (
        <FusionarDialog
          origen={fusionando}
          variantes={variantes}
          onClose={() => setFusionando(null)}
          onFusionar={(destino) => fusionar.mutate({ origen: fusionando.id, destino })}
          loading={fusionar.isPending}
        />
      )}

      <HistorialDialog item={historial} onClose={() => setHistorial(null)} />
    </div>
  );
}

/** El producto que se crea antes de guardar la variante. */
type ProductoNuevo = {
  marca: string | null;
  referencia: string | null;
  nombre: string;
  categoria: string | null;
};

const PRODUCTO_NUEVO = "__nuevo__";

/**
 * Alta o edición de una variante.
 *
 * Al crearla nace sin existencias y sin coste: todo entra por factura (Textil ›
 * Compras) o, lo que aparezca sin ella, por un recuento. Al editarla, el coste
 * medio se ve pero no se toca: lo calcula el libro de movimientos.
 */
function StockDialog({
  onOpenChange,
  item,
  escaner,
  catalogo,
  onSave,
  loading,
}: {
  onOpenChange: (o: boolean) => void;
  item: Item | null;
  escaner: boolean;
  catalogo: VarianteCatalogo[];
  onSave: (v: { variante: any; productoNuevo: ProductoNuevo | null }) => void;
  loading: boolean;
}) {
  const productosFn = useServerFn(listProductosTextil);
  const { data: datosProductos } = useQuery({
    queryKey: ["textil-productos"],
    queryFn: () => productosFn(),
    enabled: escaner,
  });
  const productos: ProductoTextil[] = (datosProductos?.productos ?? []).filter(
    (p: ProductoTextil) => p.activo || p.id === item?.producto_id,
  );
  const [f, setF] = useState<any>(() =>
    item
      ? { ...item, ean: item.ean ?? "" }
      : { nombre: "", cantidad_minima: 0, precio_venta: "", ean: "" },
  );
  const [productoId, setProductoId] = useState<string>(item?.producto_id ?? PRODUCTO_NUEVO);
  const [nuevo, setNuevo] = useState<ProductoNuevo>({
    marca: null,
    referencia: null,
    nombre: "",
    categoria: null,
  });
  const esNuevo = escaner && productoId === PRODUCTO_NUEVO;
  // El nombre de la variante nueva se propone con el del producto (y se puede cambiar).
  const ponerNombreProducto = (nombre: string) => {
    if (!item && (!f.nombre || f.nombre === nuevo.nombre)) setF({ ...f, nombre });
    setNuevo({ ...nuevo, nombre });
  };
  const elegirProducto = (id: string) => {
    setProductoId(id);
    const p = productos.find((x) => x.id === id);
    if (p && !item && !f.nombre) setF({ ...f, nombre: p.nombre, categoria: p.categoria ?? "" });
  };
  const eanMal = escaner && String(f.ean ?? "").trim() !== "" && !eanValido(f.ean);
  const v = item ? aVarianteCatalogo(item) : null;
  const recomendado = v
    ? precioRecomendado(
        {
          id: v.id,
          producto_id: productoId === PRODUCTO_NUEVO ? null : productoId,
          coste_unitario: v.coste_unitario,
        },
        catalogo,
      )
    : null;
  const faltaProducto = esNuevo && !nuevo.nombre.trim();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {escaner && (
            <div className="col-span-2 space-y-1.5">
              <Label>Producto</Label>
              <Select value={productoId} onValueChange={elegirProducto}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRODUCTO_NUEVO}>Producto nuevo</SelectItem>
                  {productos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {[p.marca, p.referencia, p.nombre].filter(Boolean).join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {esNuevo && (
            <>
              <div>
                <Label>Marca de la prenda</Label>
                <Input
                  value={nuevo.marca ?? ""}
                  onChange={(e) => setNuevo({ ...nuevo, marca: e.target.value || null })}
                />
              </div>
              <div>
                <Label>Referencia del fabricante</Label>
                <Input
                  value={nuevo.referencia ?? ""}
                  onChange={(e) => setNuevo({ ...nuevo, referencia: e.target.value || null })}
                />
              </div>
              <div className="col-span-2">
                <Label>Nombre del producto *</Label>
                <Input value={nuevo.nombre} onChange={(e) => ponerNombreProducto(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label>SKU</Label>
            <Input value={f.sku ?? ""} onChange={(e) => setF({ ...f, sku: e.target.value })} />
          </div>
          <div>
            <Label>Categoría</Label>
            <Input
              value={f.categoria ?? ""}
              onChange={(e) => setF({ ...f, categoria: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>Nombre *</Label>
            <Input
              value={f.nombre ?? ""}
              onChange={(e) => setF({ ...f, nombre: e.target.value })}
            />
          </div>
          <div>
            <Label>Color</Label>
            <Input value={f.color ?? ""} onChange={(e) => setF({ ...f, color: e.target.value })} />
          </div>
          <div>
            <Label>Talla</Label>
            <Input value={f.talla ?? ""} onChange={(e) => setF({ ...f, talla: e.target.value })} />
          </div>
          {escaner && (
            <div className="col-span-2">
              <Label>EAN</Label>
              <Input
                inputMode="numeric"
                value={f.ean ?? ""}
                className={eanMal ? "border-destructive" : ""}
                onChange={(e) => setF({ ...f, ean: e.target.value })}
              />
              {eanMal && (
                <p className="text-xs text-destructive mt-1">
                  No es un EAN válido: corrígelo o déjalo vacío.
                </p>
              )}
            </div>
          )}
          {item && (
            <div>
              <Label>Existencias</Label>
              <Input type="number" value={f.cantidad} disabled />
              <p className="text-xs text-muted-foreground mt-1">
                Se calcula sumando los movimientos. Para cambiarla, anota un movimiento o un
                recuento.
              </p>
            </div>
          )}
          <div>
            <Label>Cantidad mínima</Label>
            <Input
              type="number"
              value={f.cantidad_minima}
              onChange={(e) => setF({ ...f, cantidad_minima: Number(e.target.value) })}
            />
          </div>
          {item && (
            <div>
              <Label>Coste medio</Label>
              <Input value={eurUnitario(Number(item.coste_unitario))} disabled />
              <p className="text-xs text-muted-foreground mt-1">
                Lo calcula el libro de movimientos.
              </p>
            </div>
          )}
          <div className={item ? "" : "col-span-2"}>
            <Label>Precio venta</Label>
            <Input
              type="number"
              step="0.01"
              value={f.precio_venta}
              onChange={(e) => setF({ ...f, precio_venta: e.target.value })}
            />
            <div className="mt-1">
              <TextoRecomendado
                recomendacion={recomendado}
                sinDatos={
                  item
                    ? "Sin datos para recomendar"
                    : "Sin coste todavía: se podrá recomendar cuando entre con su factura"
                }
              />
            </div>
          </div>
          {!item && (
            <p className="col-span-2 text-xs text-muted-foreground">
              Las existencias entran con su factura (Textil › Compras) o con un recuento.
            </p>
          )}
          <div className="col-span-2">
            <Label>Notas</Label>
            <Textarea
              value={f.notas ?? ""}
              onChange={(e) => setF({ ...f, notas: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={loading || !f.nombre || eanMal || faltaProducto}
            onClick={() =>
              onSave({
                variante: {
                  id: item?.id,
                  sku: f.sku || null,
                  nombre: f.nombre,
                  categoria: f.categoria || null,
                  color: f.color || null,
                  talla: f.talla || null,
                  cantidad_minima: Number(f.cantidad_minima) || 0,
                  precio_venta: Number(f.precio_venta) || 0,
                  notas: f.notas || null,
                  ...(escaner
                    ? {
                        ean: String(f.ean ?? "").trim() || null,
                        producto_id: productoId === PRODUCTO_NUEVO ? null : productoId,
                      }
                    : {}),
                },
                productoNuevo: esNuevo
                  ? {
                      marca: nuevo.marca?.trim() || null,
                      referencia: nuevo.referencia?.trim() || null,
                      nombre: nuevo.nombre.trim(),
                      categoria: (f.categoria || "").trim() || null,
                    }
                  : null,
              })
            }
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type MotivoOtro = "merma" | "devolucion_proveedor" | "devolucion_cliente" | "ajuste_inventario";

const MOTIVOS_OTRO: { valor: MotivoOtro; etiqueta: string; ayuda: string }[] = [
  { valor: "merma", etiqueta: "Merma", ayuda: "Rota, manchada o perdida: sale del almacén." },
  {
    valor: "devolucion_proveedor",
    etiqueta: "Devolución a proveedor",
    ayuda: "Sale del almacén hacia el proveedor.",
  },
  {
    valor: "devolucion_cliente",
    etiqueta: "Devolución de cliente sin pedido",
    ayuda: "Vuelve al almacén. Si es de un pedido, se hace cambiando el pedido.",
  },
  {
    valor: "ajuste_inventario",
    etiqueta: "Ajuste de inventario",
    ayuda: "Sobran o faltan prendas sin otra explicación.",
  },
];

const SIN_COMPRA = "__ninguna__";

/**
 * Un movimiento que no es una compra ni una venta: merma, devolución a
 * proveedor, devolución de cliente sin pedido o ajuste. La cantidad se
 * escribe en positivo y el signo lo pone el motivo. Sin coste: lo congela la
 * base (las salidas al coste medio).
 */
function OtroMovimientoDialog({
  item,
  escaner,
  onClose,
  onSave,
  loading,
}: {
  item: Item;
  escaner: boolean;
  onClose: () => void;
  onSave: (v: any) => void;
  loading: boolean;
}) {
  const [motivo, setMotivo] = useState<MotivoOtro>("merma");
  const [cantidad, setCantidad] = useState(0);
  const [sentido, setSentido] = useState<"sobran" | "faltan">("faltan");
  const [compraId, setCompraId] = useState<string>(SIN_COMPRA);
  const [nota, setNota] = useState("");

  // Las compras textil registradas que metieron género (facturas y proformas;
  // nunca la factura casada con su proforma), para enlazar una devolución.
  const comprasFn = useServerFn(listCompras);
  const { data: datosCompras } = useQuery({
    queryKey: ["compras", "textil"],
    queryFn: () => comprasFn({ data: { soloTextil: true } }),
    enabled: escaner && motivo === "devolucion_proveedor",
  });
  const compras = useMemo(
    () =>
      comprasParaDevolucion(
        ((datosCompras?.compras ?? []) as any[]).filter((c) => c.estado === "registrada"),
      ),
    [datosCompras],
  );

  const entra =
    motivo === "devolucion_cliente" || (motivo === "ajuste_inventario" && sentido === "sobran");
  const ayuda = MOTIVOS_OTRO.find((m) => m.valor === motivo)?.ayuda ?? "";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Otro movimiento</DialogTitle>
          <DialogDescription>
            {item.nombre}
            {item.color ? ` · ${item.color}` : ""}
            {item.talla ? ` · ${item.talla}` : ""} — ahora hay {item.cantidad}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Qué ha pasado</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoOtro)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_OTRO.map((m) => (
                  <SelectItem key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ayuda}</p>
          </div>
          {motivo === "ajuste_inventario" && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={sentido === "sobran" ? "default" : "outline"}
                onClick={() => setSentido("sobran")}
              >
                Sobran
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sentido === "faltan" ? "default" : "outline"}
                onClick={() => setSentido("faltan")}
              >
                Faltan
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Unidades</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={cantidad}
              onChange={(e) => setCantidad(Math.abs(Number(e.target.value) || 0))}
            />
            <p className="text-xs text-muted-foreground">
              {entra ? "Entran en el almacén." : "Salen del almacén al coste medio."}
            </p>
          </div>
          {escaner && motivo === "devolucion_proveedor" && (
            <div className="space-y-1.5">
              <Label>Factura de la compra (opcional)</Label>
              <Select value={compraId} onValueChange={setCompraId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_COMPRA}>Sin enlazar</SelectItem>
                  {compras.map(({ compra: c, facturadaEn }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {[
                        c.proveedor,
                        c.tipo_documento === "proforma" ? "proforma" : null,
                        c.numero && `n.º ${c.numero}`,
                        c.fecha,
                        facturadaEn !== null && `facturada en n.º ${facturadaEn}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Nota</Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Qué ha pasado, quién lo vio…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Las entradas por compra se registran con su factura en Textil › Compras.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={loading || cantidad <= 0}
            onClick={() =>
              onSave({
                stock_id: item.id,
                motivo,
                cantidad: entra ? cantidad : -cantidad,
                nota: nota || null,
                ...(motivo === "devolucion_proveedor" && compraId !== SIN_COMPRA
                  ? { compra_id: compraId }
                  : {}),
              })
            }
          >
            Anotar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fusionar una variante repetida con la buena (mismo producto, color y talla):
 * sus existencias y su historial pasan a la de destino y la repetida queda
 * desactivada.
 */
function FusionarDialog({
  origen,
  variantes,
  onClose,
  onFusionar,
  loading,
}: {
  origen: VarianteCatalogo;
  variantes: VarianteCatalogo[];
  onClose: () => void;
  onFusionar: (destino: string) => void;
  loading: boolean;
}) {
  const candidatas = variantes.filter(
    (v) =>
      v.id !== origen.id &&
      utilizable(v) &&
      v.producto_id === origen.producto_id &&
      claveTexto(v.color) === claveTexto(origen.color) &&
      claveTalla(v.talla) === claveTalla(origen.talla),
  );
  const [destino, setDestino] = useState<string>(candidatas[0]?.id ?? "");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fusionar con…</DialogTitle>
          <DialogDescription>
            {etiquetaVariante(origen)} está repetida. Al fusionarla, sus {origen.cantidad} unidades
            y su historial pasan a la variante buena, y esta queda desactivada. No se deshace.
          </DialogDescription>
        </DialogHeader>
        {candidatas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay otra variante activa del mismo producto, color y talla con la que fusionarla.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label>Variante buena</Label>
            <Select value={destino} onValueChange={setDestino}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidatas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {etiquetaVariante(c)}
                    {c.sku ? ` · ${c.sku}` : ""} ({c.cantidad} uds)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={loading || !destino} onClick={() => onFusionar(destino)}>
            Fusionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Recuento físico.
 *
 * Se escribe lo que se ha contado, no la diferencia: contar es lo que haces con
 * las manos, y restar mentalmente antes de teclear es donde se cometen los
 * errores. La diferencia la calcula la pantalla y se anota como ajuste.
 */
function RecuentoDialog({ item, onClose, onSave, loading }: any) {
  const [contado, setContado] = useState(0);
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (item) {
      setContado(Number(item.cantidad) || 0);
      setNota("");
    }
  }, [item]);

  const sistema = Number(item?.cantidad ?? 0);
  const diferencia = contado - sistema;

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recuento físico</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {item.nombre}
              {item.color ? ` · ${item.color}` : ""}
              {item.talla ? ` · ${item.talla}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>El sistema dice</Label>
                <Input value={sistema} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>He contado</Label>
                <Input
                  type="number"
                  step="1"
                  value={contado}
                  onChange={(e) => setContado(Number(e.target.value))}
                />
              </div>
            </div>
            <div
              className={`rounded-md border p-3 text-sm ${
                diferencia === 0 ? "bg-muted/30" : "border-amber-500/50 bg-amber-500/10"
              }`}
            >
              {diferencia === 0
                ? "Cuadra. No hace falta ajustar."
                : `Diferencia de ${diferencia > 0 ? "+" : ""}${diferencia}. Se anotará como ajuste de inventario.`}
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Rotura, faltante, error de alta…"
              />
              <p className="text-xs text-muted-foreground">
                Conviene explicarlo: dentro de seis meses, un ajuste sin motivo no le dice nada a
                nadie.
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={loading || diferencia === 0}
            onClick={() =>
              onSave({
                stock_id: item.id,
                motivo: "ajuste_inventario",
                cantidad: diferencia,
                nota: nota || `Recuento físico: contado ${contado}, sistema ${sistema}`,
              })
            }
          >
            Ajustar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVO_TEXTO: Record<string, string> = {
  inicial: "Existencias iniciales",
  compra: "Compra",
  venta: "Venta",
  devolucion_cliente: "Devolución de cliente",
  devolucion_proveedor: "Devolución a proveedor",
  ajuste_inventario: "Ajuste de inventario",
  merma: "Merma",
  ajuste_coste: "Ajuste de coste",
};

/** Los movimientos que devuelve listMovimientosStock como mucho (su `.limit(200)`). */
const LIMITE_MOVIMIENTOS = 200;

/**
 * Unas unidades con su signo delante, como en las filas del libro. `|| 0`
 * porque un −0 (sin salidas) se pintaría «-0».
 */
const conSigno = (n: number) => `${n > 0 ? "+" : ""}${numero(n || 0, 0)}`;

/** El libro de una variante: de dónde sale cada unidad que tiene o tuvo. */
function HistorialDialog({ item, onClose }: any) {
  const listFn = useServerFn(listMovimientosStock);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock-movimientos", item?.id],
    queryFn: () => listFn({ data: { stock_id: item.id } }),
    enabled: !!item,
  });
  // Si la lista llega cortada, su saldo no es el «saldo actual» de arriba: se dice.
  const totales = useMemo(() => totalesMovimientosStock(data, LIMITE_MOVIMIENTOS), [data]);

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de movimientos</DialogTitle>
        </DialogHeader>
        {item && (
          <p className="text-sm text-muted-foreground">
            {item.nombre}
            {item.color ? ` · ${item.color}` : ""}
            {item.talla ? ` · ${item.talla}` : ""} — saldo actual {item.cantidad}
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos.</p>
        ) : (
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                {/* El ajuste de coste no tiene coste unitario: lleva el importe total. */}
                <TableHead className="text-right">Coste unit. / importe</TableHead>
                <TableHead>Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">
                    {new Date(m.created_at).toLocaleString("es-ES")}
                  </TableCell>
                  <TableCell>{MOTIVO_TEXTO[m.motivo] ?? m.motivo}</TableCell>
                  {m.motivo === "ajuste_coste" ? (
                    // Revaloriza lo que queda (factura casada con su proforma): sin
                    // unidades, con su importe.
                    <>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {eurConSigno(Number(m.importe_ajuste ?? 0))}{" "}
                        <span className="text-xs text-muted-foreground">en total</span>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell
                        className={`text-right font-medium ${
                          Number(m.cantidad) > 0 ? "text-emerald-600" : "text-destructive"
                        }`}
                      >
                        {Number(m.cantidad) > 0 ? "+" : ""}
                        {m.cantidad}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtEUR(Number(m.coste_unitario))}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-xs text-muted-foreground">{m.nota ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Entradas</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {conSigno(totales.entradas)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Salidas</TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {conSigno(-totales.salidas)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>
                  {totales.recortada
                    ? `Saldo de los últimos ${totales.movimientos} movimientos · puede haber otros más antiguos que no se ven: no es el saldo actual`
                    : `Saldo · ${totales.movimientos} movimiento${totales.movimientos === 1 ? "" : "s"}`}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {conSigno(totales.saldo)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
