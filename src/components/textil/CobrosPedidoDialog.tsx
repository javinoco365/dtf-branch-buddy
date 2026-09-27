import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { eur, fechaCorta } from "@/lib/format";
import { listarCatalogosCaja } from "@/lib/caja.functions";
import { borrarCobroTextil, registrarCobroTextil, type CobroTextil } from "@/lib/textil.functions";
import {
  METODOS_COBRO,
  destinoDelCobro,
  resumenCobros,
  type EstadoCobro,
  type MetodoCobro,
} from "@/dominio/cobros-textil";

const ETIQUETA_ESTADO_COBRO: Record<EstadoCobro, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "text-status-pendiente" },
  parcial: { texto: "Parcial", clase: "text-status-procesando" },
  cobrado: { texto: "Cobrado", clase: "text-status-completado" },
  excedido: { texto: "Cobrado de más", clase: "text-status-cancelado" },
};

export function EstadoCobroTexto({ estado }: { estado: EstadoCobro }) {
  const e = ETIQUETA_ESTADO_COBRO[estado];
  return <span className={`text-xs font-medium ${e.clase}`}>{e.texto}</span>;
}

const etiquetaMetodo = (m: MetodoCobro) => METODOS_COBRO.find((x) => x.valor === m)?.etiqueta ?? m;

type PedidoCobrable = {
  id: string;
  numero: string;
  total: number | string;
  estado: string;
};

/**
 * Los cobros de un pedido textil, y el alta de uno nuevo.
 *
 * Un pedido se puede cobrar en varias veces. Adónde va cada cobro lo decide el
 * método: el efectivo entra en Caja como ingreso; la tarjeta y la
 * transferencia cuentan en la Facturación Consolidada. Lo hace la base en una
 * sola transacción, así que aquí solo se elige.
 */
export function CobrosPedidoDialog({
  open,
  onOpenChange,
  pedido,
  cobros,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pedido: PedidoCobrable;
  cobros: CobroTextil[];
}) {
  const qc = useQueryClient();
  const registrar = useServerFn(registrarCobroTextil);
  const borrar = useServerFn(borrarCobroTextil);
  const catalogos = useServerFn(listarCatalogosCaja);

  const resumen = resumenCobros(pedido.total, cobros);
  const cancelado = pedido.estado === "cancelado";
  const admiteCobro = !cancelado && resumen.pendiente > 0;

  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState("");
  const [metodo, setMetodo] = useState<MetodoCobro>("efectivo");
  const [conceptoId, setConceptoId] = useState("");
  const [notas, setNotas] = useState("");
  const [borrando, setBorrando] = useState<CobroTextil | null>(null);

  const { data: cat } = useQuery({
    queryKey: ["caja-catalogos"],
    queryFn: () => catalogos(),
    enabled: open,
  });
  const conceptosIngreso = useMemo(
    () => (cat?.conceptos ?? []).filter((c) => c.activo && c.categoria === "ingreso"),
    [cat],
  );

  useEffect(() => {
    if (!open) return;
    setFecha(new Date().toISOString().slice(0, 10));
    setMetodo("efectivo");
    setNotas("");
  }, [open]);

  // Por defecto se cobra lo que queda. Se recalcula al abrir y cada vez que un
  // cobro nuevo o uno borrado cambian lo pendiente, ya con los datos recargados.
  useEffect(() => {
    if (!open) return;
    setImporte(resumen.pendiente > 0 ? String(resumen.pendiente).replace(".", ",") : "");
  }, [open, resumen.pendiente]);

  // Si hay un concepto que se llame como el textil, es el obvio.
  useEffect(() => {
    if (conceptoId || conceptosIngreso.length === 0) return;
    const textil = conceptosIngreso.find((c) => /textil/i.test(c.nombre));
    setConceptoId((textil ?? conceptosIngreso[0]).id);
  }, [conceptosIngreso, conceptoId]);

  function refrescar() {
    qc.invalidateQueries({ queryKey: ["textil-cobros"] });
    qc.invalidateQueries({ queryKey: ["caja"] });
    qc.invalidateQueries({ queryKey: ["cobros-textil-periodo"] });
  }

  const alta = useMutation({
    mutationFn: async () => {
      const n = Number(importe.trim().replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) throw new Error("El importe tiene que ser mayor que cero");
      if (n > resumen.pendiente + 0.005) {
        throw new Error(`Solo quedan ${eur(resumen.pendiente)} pendientes`);
      }
      if (metodo === "efectivo" && !conceptoId) {
        throw new Error("Elige el concepto de caja");
      }
      return registrar({
        data: {
          pedido_id: pedido.id,
          fecha,
          importe: n,
          metodo,
          concepto_caja_id: metodo === "efectivo" ? conceptoId : null,
          notas: notas.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(
        destinoDelCobro(metodo) === "caja"
          ? "Cobro registrado y apuntado en Caja"
          : "Cobro registrado. Cuenta en la Facturación Consolidada",
      );
      setNotas("");
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido registrar el cobro"),
  });

  const baja = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Cobro borrado");
      setBorrando(null);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido borrar"),
  });

  const etiqueta = ETIQUETA_ESTADO_COBRO[resumen.estado];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        // Sin esto el foco cae en la papelera del primer cobro.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Cobros del pedido {pedido.numero}</DialogTitle>
          <DialogDescription>
            El efectivo entra en Caja; la tarjeta y la transferencia cuentan en la Facturación
            Consolidada.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 rounded-md border p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold tabular-nums">{eur(Number(pedido.total))}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Cobrado</div>
            <div className="font-semibold tabular-nums">{eur(resumen.cobrado)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {resumen.estado === "excedido" ? "Cobrado de más" : "Pendiente"}
            </div>
            <div className={`font-semibold tabular-nums ${etiqueta.clase}`}>
              {eur(Math.abs(resumen.pendiente))}
            </div>
          </div>
        </div>

        {resumen.estado === "excedido" && (
          <p className="text-xs text-status-cancelado">
            El total del pedido se ha bajado por debajo de lo ya cobrado. Revisa el pedido o borra
            el cobro que sobre.
          </p>
        )}

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Cobros registrados
          </Label>
          {cobros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha cobrado nada.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {cobros.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="tabular-nums w-20 shrink-0">{fechaCorta(c.fecha)}</span>
                  <span className="flex-1 min-w-0">
                    {etiquetaMetodo(c.metodo)}
                    <span className="text-xs text-muted-foreground ml-2">
                      → {destinoDelCobro(c.metodo) === "caja" ? "Caja" : "Facturación"}
                    </span>
                    {c.notas && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {c.notas}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums font-medium">{eur(Number(c.importe))}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Borrar cobro"
                    onClick={() => setBorrando(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cancelado ? (
          <p className="text-sm text-muted-foreground">
            El pedido está cancelado: no admite cobros nuevos.
          </p>
        ) : admiteCobro ? (
          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Registrar cobro
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Importe (€)</Label>
                <Input
                  inputMode="decimal"
                  value={importe}
                  onChange={(e) => setImporte(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Método</Label>
                <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoCobro)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METODOS_COBRO.map((m) => (
                      <SelectItem key={m.valor} value={m.valor}>
                        {m.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {metodo === "efectivo" && (
                <div className="space-y-1">
                  <Label>Concepto de caja</Label>
                  <Select value={conceptoId} onValueChange={setConceptoId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elige un concepto" />
                    </SelectTrigger>
                    <SelectContent>
                      {conceptosIngreso.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="p. ej. el textil; falta la personalización"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {metodo === "efectivo"
                ? "Se apunta como ingreso en Caja con el concepto elegido."
                : "No pasa por Caja: cuenta en la Facturación Consolidada, en la fila Textil personalizado."}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => alta.mutate()} disabled={alta.isPending}>
                {alta.isPending ? "Registrando…" : "Registrar cobro"}
              </Button>
            </div>
          </div>
        ) : resumen.estado === "cobrado" ? (
          <p className="text-sm text-status-completado">El pedido está cobrado entero.</p>
        ) : null}

        <ConfirmarBorrado
          abierto={!!borrando}
          onCerrar={() => setBorrando(null)}
          que={
            borrando
              ? `el cobro de ${eur(Number(borrando.importe))} del ${fechaCorta(borrando.fecha)}`
              : "el cobro"
          }
          consecuencias={
            borrando?.metodo === "efectivo"
              ? ["Se borra también su apunte de ingreso en Caja", "El importe vuelve a pendiente"]
              : ["Deja de contar en la Facturación Consolidada", "El importe vuelve a pendiente"]
          }
          cargando={baja.isPending}
          onConfirmar={() => borrando && baja.mutate(borrando.id)}
        />
      </DialogContent>
    </Dialog>
  );
}
