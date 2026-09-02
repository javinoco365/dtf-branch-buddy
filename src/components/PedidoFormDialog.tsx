import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { createPedidoManual, updatePedido } from "@/lib/pedidos.functions";
import type { PedidoFila } from "@/components/PedidosTable";
import { eur } from "@/lib/format";
import { calcularTotales, redondear } from "@/dominio/importes";

type Linea = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_rate: number;
};

const PAGOS = [
  "Transferencia bancaria directa",
  "Bizum",
  "Pago con tarjeta (Redsys)",
  "Contra reembolso",
  "Efectivo",
  "Otro",
];

export function PedidoFormDialog({
  open,
  onOpenChange,
  tiendaId,
  pedido,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tiendaId: string;
  pedido?: PedidoFila;
  onSaved: () => void;
}) {
  const esEdicion = !!pedido;
  const [cliente, setCliente] = useState("");
  const [email, setEmail] = useState("");
  const [pago, setPago] = useState<string>("Transferencia bancaria directa");
  const [envio, setEnvio] = useState<number>(0);
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([
    { descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 },
  ]);

  useEffect(() => {
    if (!open) return;
    if (pedido) {
      setCliente(pedido.cliente_nombre ?? "");
      setEmail(pedido.cliente_email ?? "");
      setPago(pedido.metodo_pago ?? "Transferencia bancaria directa");
      setEnvio(Number(pedido.envio ?? 0));
      setNotas(pedido.notas ?? "");
      setLineas(
        pedido.items.length
          ? pedido.items.map((it) => ({
              descripcion: it.descripcion,
              cantidad: Number(it.cantidad),
              precio_unitario: Number(it.precio_unitario),
              iva_rate: 21,
            }))
          : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 }],
      );
    } else {
      setCliente("");
      setEmail("");
      setPago("Transferencia bancaria directa");
      setEnvio(0);
      setNotas("");
      setLineas([{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 }]);
    }
  }, [open, pedido]);

  const createFn = useServerFn(createPedidoManual);
  const updateFn = useServerFn(updatePedido);

  const mut = useMutation({
    mutationFn: async () => {
      const itemsValidos = lineas.filter((l) => l.descripcion.trim() && l.cantidad > 0);
      if (itemsValidos.length === 0) throw new Error("Añade al menos una línea");
      if (esEdicion && pedido) {
        return updateFn({
          data: {
            id: pedido.id,
            cliente_nombre: cliente,
            cliente_email: email || null,
            metodo_pago: pago,
            envio,
            notas: notas || null,
            items: itemsValidos,
          },
        });
      }
      if (!cliente.trim()) throw new Error("Indica el nombre del cliente");
      return createFn({
        data: {
          tiendaId,
          cliente_nombre: cliente,
          cliente_email: email || null,
          metodo_pago: pago,
          envio,
          notas: notas || null,
          items: itemsValidos,
        },
      });
    },
    onSuccess: () => {
      toast.success(esEdicion ? "Pedido actualizado" : "Pedido creado");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || "Error al guardar"),
  });

  function setLinea(i: number, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // OJO, criterio fiscal pendiente de decidir: hoy el envío se suma DESPUÉS del
  // IVA, es decir, no tributa. El artículo 78 de la Ley del IVA dice que los
  // gastos de transporte repercutidos forman parte de la base imponible.
  // Cambiarlo altera el total de todos los pedidos manuales, así que se conserva
  // el criterio actual y la decisión va aparte. Cuando se cambie, basta con
  // pasar { envio } a calcularTotales y quitar la suma de abajo, aquí y en
  // createPedidoManual.
  const totales = calcularTotales(lineas);
  const total = redondear(totales.total + (envio || 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar pedido" : "Nuevo pedido manual"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Método de pago</Label>
              <Select value={pago} onValueChange={setPago}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGOS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Gastos de envío (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={envio}
                onChange={(e) => setEnvio(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Líneas</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLineas([
                    ...lineas,
                    { descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 },
                  ])
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Añadir línea
              </Button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Producto</Label>
                    <Input
                      value={l.descripcion}
                      onChange={(e) => setLinea(i, { descripcion: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={l.cantidad}
                      onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Precio</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={l.precio_unitario}
                      onChange={(e) =>
                        setLinea(i, { precio_unitario: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">IVA %</Label>
                    <Input
                      type="number"
                      step="1"
                      value={l.iva_rate}
                      onChange={(e) => setLinea(i, { iva_rate: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLineas(lineas.filter((_, idx) => idx !== i))}
                      disabled={lineas.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm pt-2 border-t">
            <div>
              Subtotal: <span className="font-medium">{eur(totales.base_imponible)}</span>
            </div>
            <div>
              IVA: <span className="font-medium">{eur(totales.iva_total)}</span>
            </div>
            <div>
              Total: <span className="font-semibold">{eur(total)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
