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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { borrarCobro, registrarCobro, type Cobro } from "@/lib/cobros.functions";
import {
  METODOS_COBRO,
  etiquetaMetodo,
  pasaPorCaja,
  repartirCobro,
  resumenCobros,
  type EstadoCobro,
  type MetodoCobroManual,
} from "@/dominio/cobros";

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

/** Lo que el diálogo necesita saber del pedido, venga de una tienda o del textil. */
export type PedidoCobrable = {
  id: string;
  numero: string;
  total: number | string;
  tipo: "tienda" | "textil";
  cancelado: boolean;
  /** De WooCommerce: se cobra en la web y su cobro lo pone la sincronización. */
  web?: boolean;
};

/** El importe como lo escribe una persona: «12,50» o «12.50». */
function leerImporte(texto: string): number {
  return Number(texto.trim().replace(",", "."));
}

/**
 * Los cobros de un pedido, y el alta de uno nuevo.
 *
 * Un pedido se puede cobrar en varias veces. Todo cobro cuenta en la
 * Facturación Consolidada con su método; el efectivo, además, entra en Caja
 * como ingreso. Si lo recibido supera
 * lo pendiente, hay que marcar «propina»: la parte que sobra se apunta aparte
 * y no descuenta del pedido. Todo lo hace la base en una sola transacción.
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
  cobros: Cobro[];
}) {
  const qc = useQueryClient();
  const registrar = useServerFn(registrarCobro);
  const borrar = useServerFn(borrarCobro);
  const catalogos = useServerFn(listarCatalogosCaja);

  const resumen = resumenCobros(pedido.total, cobros);
  const propinas = cobros.reduce((s, c) => s + Number(c.propina ?? 0), 0);
  const admiteCobro = !pedido.cancelado && !pedido.web;

  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState("");
  const [metodo, setMetodo] = useState<MetodoCobroManual>("efectivo");
  const [esPropina, setEsPropina] = useState(false);
  const [conceptoId, setConceptoId] = useState("");
  const [notas, setNotas] = useState("");
  const [borrando, setBorrando] = useState<Cobro | null>(null);

  const { data: cat } = useQuery({
    queryKey: ["caja-catalogos"],
    queryFn: () => catalogos(),
    enabled: open && admiteCobro,
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
    setEsPropina(false);
  }, [open, resumen.pendiente]);

  // Si hay un concepto que se llame como lo que se cobra, es el obvio.
  useEffect(() => {
    if (conceptoId || conceptosIngreso.length === 0) return;
    const patron = pedido.tipo === "textil" ? /textil/i : /metro|dtf/i;
    const obvio = conceptosIngreso.find((c) => patron.test(c.nombre));
    setConceptoId((obvio ?? conceptosIngreso[0]).id);
  }, [conceptosIngreso, conceptoId, pedido.tipo]);

  const recibido = leerImporte(importe);
  const reparto =
    Number.isFinite(recibido) && recibido > 0
      ? repartirCobro(recibido, resumen.pendiente)
      : { importe: 0, propina: 0 };
  const hayExceso = reparto.propina > 0;

  function refrescar() {
    qc.invalidateQueries({ queryKey: ["pedidos"] });
    qc.invalidateQueries({ queryKey: ["textil-cobros"] });
    qc.invalidateQueries({ queryKey: ["caja"] });
    qc.invalidateQueries({ queryKey: ["cobros-periodo"] });
    qc.invalidateQueries({ queryKey: ["cobros-pendientes-pedidos"] });
    qc.invalidateQueries({ queryKey: ["cobros-pedido"] });
  }

  const alta = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(recibido) || recibido <= 0) {
        throw new Error("El importe tiene que ser mayor que cero");
      }
      if (hayExceso && !esPropina) {
        throw new Error(
          `Solo quedan ${eur(Math.max(resumen.pendiente, 0))} pendientes: marca «propina» para cobrar más`,
        );
      }
      if (metodo === "efectivo" && !conceptoId) {
        throw new Error("Elige el concepto de caja");
      }
      return registrar({
        data: {
          pedido_id: pedido.tipo === "tienda" ? pedido.id : null,
          textil_pedido_id: pedido.tipo === "textil" ? pedido.id : null,
          fecha,
          importe: recibido,
          metodo,
          es_propina: hayExceso && esPropina,
          concepto_caja_id: metodo === "efectivo" ? conceptoId : null,
          notas: notas.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(
        pasaPorCaja(metodo) ? "Cobro registrado y apuntado en Caja" : "Cobro registrado",
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
            Todo lo cobrado cuenta en la Facturación Consolidada. El efectivo, además, entra en
            Caja.
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
            {propinas > 0 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                + {eur(propinas)} de propina
              </div>
            )}
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
                      {pasaPorCaja(c.metodo) ? "→ también en Caja" : ""}
                    </span>
                    {c.previo && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-[10px]"
                        title="Cobrado antes de registrar cobros, sin presupuesto"
                      >
                        Previo
                      </Badge>
                    )}
                    {c.notas && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {c.notas}
                      </span>
                    )}
                  </span>
                  <span className="text-right">
                    <span className="block tabular-nums font-medium">{eur(Number(c.importe))}</span>
                    {Number(c.propina) > 0 && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        + {eur(Number(c.propina))} propina
                      </span>
                    )}
                  </span>
                  {c.metodo === "web" ? (
                    // El cobro web sigue al pedido de WooCommerce: no se borra a mano.
                    <span className="w-9" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Borrar cobro"
                      onClick={() => setBorrando(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {pedido.cancelado ? (
          <p className="text-sm text-muted-foreground">
            El pedido está cancelado: no admite cobros nuevos.
          </p>
        ) : pedido.web ? (
          <p className="text-sm text-muted-foreground">
            Es un pedido de la tienda online: se cobra en la web, y su cobro llega al sincronizar
            cuando WooCommerce lo da por pagado.
          </p>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Registrar cobro
            </Label>
            {resumen.pendiente <= 0 && (
              <p className="text-xs text-status-completado">
                El pedido está cobrado entero. Lo que se cobre ahora es propina.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Importe recibido (€)</Label>
                <Input
                  inputMode="decimal"
                  value={importe}
                  onChange={(e) => {
                    setImporte(e.target.value);
                    // La propina se confirma para el importe que se ve, no
                    // para uno anterior.
                    setEsPropina(false);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Método</Label>
                <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoCobroManual)}>
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

            {hayExceso && (
              <label
                className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                  esPropina ? "border-primary" : "border-status-cancelado"
                }`}
              >
                <Checkbox
                  checked={esPropina}
                  onCheckedChange={(v) => setEsPropina(v === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Es propina</span>
                  <span className="block text-xs text-muted-foreground">
                    Supera lo pendiente. {eur(reparto.importe)} van al pedido y{" "}
                    {eur(reparto.propina)} se apuntan como propina.
                  </span>
                </span>
              </label>
            )}

            <div className="space-y-1">
              <Label>Notas</Label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="p. ej. el anticipo; falta el resto"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {metodo === "efectivo"
                ? "Cuenta en la Consolidada como efectivo y se apunta como ingreso en Caja con el concepto elegido, propina incluida."
                : "Cuenta en la Consolidada. No pasa por Caja."}
            </p>
            <div className="flex justify-end">
              <Button
                onClick={() => alta.mutate()}
                disabled={alta.isPending || (hayExceso && !esPropina)}
              >
                {alta.isPending ? "Registrando…" : "Registrar cobro"}
              </Button>
            </div>
          </div>
        )}

        <ConfirmarBorrado
          abierto={!!borrando}
          onCerrar={() => setBorrando(null)}
          que={
            borrando
              ? `el cobro de ${eur(Number(borrando.importe) + Number(borrando.propina ?? 0))} del ${fechaCorta(borrando.fecha)}`
              : "el cobro"
          }
          consecuencias={
            borrando?.metodo === "efectivo"
              ? [
                  "Se borra también su apunte de ingreso en Caja",
                  "Deja de contar en la Facturación Consolidada",
                  "El importe vuelve a pendiente",
                ]
              : ["Deja de contar en la Facturación Consolidada", "El importe vuelve a pendiente"]
          }
          cargando={baja.isPending}
          onConfirmar={() => borrando && baja.mutate(borrando.id)}
        />
      </DialogContent>
    </Dialog>
  );
}
