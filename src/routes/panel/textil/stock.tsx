import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, PackagePlus, ClipboardCheck, History } from "lucide-react";
import {
  listStock,
  upsertStockItem,
  deleteStockItem,
  registrarMovimientoStock,
  listMovimientosStock,
} from "@/lib/textil.functions";
import { toast } from "sonner";
import { eur as fmtEUR } from "@/lib/format";

export const Route = createFileRoute("/panel/textil/stock")({
  head: () => ({ meta: [{ title: "Stock textil · DTF Culture" }] }),
  component: StockPage,
});

type Item = any;

function StockPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listStock);
  const upsertFn = useServerFn(upsertStockItem);
  const delFn = useServerFn(deleteStockItem);
  const { data = [], isLoading } = useQuery({
    queryKey: ["textil-stock"],
    queryFn: () => listFn(),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [entrada, setEntrada] = useState<Item | null>(null);
  const [recuento, setRecuento] = useState<Item | null>(null);
  const [historial, setHistorial] = useState<Item | null>(null);

  const movimientoFn = useServerFn(registrarMovimientoStock);
  const movimiento = useMutation({
    mutationFn: (d: any) => movimientoFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["stock-movimientos"] });
      toast.success("Movimiento anotado");
      setEntrada(null);
      setRecuento(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const upsert = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      toast.success("Guardado");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
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
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Cat.</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Talla</TableHead>
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
                  <TableCell colSpan={12}>Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Sin artículos.
                  </TableCell>
                </TableRow>
              )}
              {data.map((it: any) => {
                const reservado = Number(it.cantidad_reservada ?? 0);
                const disponible = Number(it.cantidad) - reservado;
                // El aviso mira lo disponible, no lo físico: tener 20 en el
                // armario con 18 comprometidos no es tener 20 para vender.
                const bajo = disponible <= Number(it.cantidad_minima);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.sku ?? "—"}</TableCell>
                    <TableCell className="font-medium">{it.nombre}</TableCell>
                    <TableCell>{it.categoria ?? "—"}</TableCell>
                    <TableCell>{it.color ?? "—"}</TableCell>
                    <TableCell>{it.talla ?? "—"}</TableCell>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Entrada de mercancía"
                        onClick={() => setEntrada(it)}
                      >
                        <PackagePlus className="h-4 w-4" />
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
                                "porque su historia explica el coste de lo que ya vendiste.",
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
          </Table>
        </CardContent>
      </Card>

      <StockDialog
        open={open}
        onOpenChange={setOpen}
        item={editing}
        onSave={(v: any) => upsert.mutate(v)}
        loading={upsert.isPending}
      />

      <EntradaDialog
        item={entrada}
        onClose={() => setEntrada(null)}
        onSave={(v: any) => movimiento.mutate(v)}
        loading={movimiento.isPending}
      />

      <RecuentoDialog
        item={recuento}
        onClose={() => setRecuento(null)}
        onSave={(v: any) => movimiento.mutate(v)}
        loading={movimiento.isPending}
      />

      <HistorialDialog item={historial} onClose={() => setHistorial(null)} />
    </div>
  );
}

function StockDialog({ open, onOpenChange, item, onSave, loading }: any) {
  const [f, setF] = useState<any>(
    () =>
      item ?? { nombre: "", cantidad: 0, cantidad_minima: 0, coste_unitario: 0, precio_venta: 0 },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o)
          setF(
            item ?? {
              nombre: "",
              cantidad: 0,
              cantidad_minima: 0,
              coste_unitario: 0,
              precio_venta: 0,
            },
          );
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
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
          <div>
            <Label>{item ? "Existencias" : "Existencias iniciales"}</Label>
            <Input
              type="number"
              value={f.cantidad}
              disabled={!!item}
              onChange={(e) => setF({ ...f, cantidad: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {item
                ? "Se calcula sumando los movimientos. Para cambiarla, anota una entrada o un recuento."
                : "Lo que hay hoy. Queda anotado como movimiento inicial."}
            </p>
          </div>
          <div>
            <Label>Cantidad mínima</Label>
            <Input
              type="number"
              value={f.cantidad_minima}
              onChange={(e) => setF({ ...f, cantidad_minima: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Coste unitario</Label>
            <Input
              type="number"
              step="0.01"
              value={f.coste_unitario}
              onChange={(e) => setF({ ...f, coste_unitario: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Precio venta</Label>
            <Input
              type="number"
              step="0.01"
              value={f.precio_venta}
              onChange={(e) => setF({ ...f, precio_venta: Number(e.target.value) })}
            />
          </div>
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
            disabled={loading || !f.nombre}
            onClick={() =>
              onSave({
                id: item?.id,
                sku: f.sku || null,
                nombre: f.nombre,
                categoria: f.categoria || null,
                color: f.color || null,
                talla: f.talla || null,
                cantidad: Number(f.cantidad) || 0,
                cantidad_minima: Number(f.cantidad_minima) || 0,
                coste_unitario: Number(f.coste_unitario) || 0,
                precio_venta: Number(f.precio_venta) || 0,
                notas: f.notas || null,
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

/**
 * Entrada de mercancía: una compra.
 *
 * Pide el coste porque de ahí sale el coste medio ponderado, y sin coste medio
 * el margen de lo que vendas es una estimación, no un dato.
 */
function EntradaDialog({ item, onClose, onSave, loading }: any) {
  const [cantidad, setCantidad] = useState(0);
  const [coste, setCoste] = useState(0);
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (item) {
      setCantidad(0);
      setCoste(Number(item.coste_unitario) || 0);
      setNota("");
    }
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Entrada de mercancía</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {item.nombre}
              {item.color ? ` · ${item.color}` : ""}
              {item.talla ? ` · ${item.talla}` : ""} — ahora hay {item.cantidad}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unidades que entran</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={cantidad}
                  onChange={(e) => setCantidad(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Coste por unidad</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={coste}
                  onChange={(e) => setCoste(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nota</Label>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Factura del proveedor, albarán…"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              El coste medio de la variante se recalcula con esta entrada.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={loading || cantidad <= 0}
            onClick={() =>
              onSave({
                stock_id: item.id,
                motivo: "compra",
                cantidad,
                coste_unitario: coste,
                nota: nota || null,
              })
            }
          >
            Anotar entrada
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
                coste_unitario: 0,
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
};

/** El libro de una variante: de dónde sale cada unidad que tiene o tuvo. */
function HistorialDialog({ item, onClose }: any) {
  const listFn = useServerFn(listMovimientosStock);
  const { data = [], isLoading } = useQuery({
    queryKey: ["stock-movimientos", item?.id],
    queryFn: () => listFn({ data: { stock_id: item.id } }),
    enabled: !!item,
  });

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">Coste unit.</TableHead>
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
                  <TableCell
                    className={`text-right font-medium ${
                      Number(m.cantidad) > 0 ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {Number(m.cantidad) > 0 ? "+" : ""}
                    {m.cantidad}
                  </TableCell>
                  <TableCell className="text-right">{fmtEUR(Number(m.coste_unitario))}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.nota ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
