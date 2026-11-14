import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormularioDialogo } from "@/components/FormularioDialogo";
import { eur } from "@/lib/format";
import { avisarError } from "@/lib/errores";
import { ajustarImportePedido } from "@/lib/pedidos.functions";
import { leerNumeroEscrito } from "@/dominio/numeros";
import {
  devolucionesDelPedido,
  opcionesImporteReal,
  type DevolucionDePedido,
} from "@/dominio/cobros";

const conComa = (n: number) => n.toFixed(2).replace(".", ",");

/**
 * El importe real de un pedido de tienda: cuando lo que de verdad se vende no
 * es el total (el envío que no se cobró porque se recogió en el local, un
 * precio acordado…). Se guarda como una rebaja con su motivo; WooCommerce no
 * se toca. Solo para quien escribe.
 */
export function AjusteImporte({
  pedidoId,
  total,
  envio,
  base,
  devoluciones,
  cobrado,
}: {
  pedidoId: string;
  total: number | string;
  envio: number | string | null | undefined;
  base: number;
  devoluciones: readonly DevolucionDePedido[];
  cobrado: number;
}) {
  const qc = useQueryClient();
  const ajustar = useServerFn(ajustarImportePedido);
  const { reembolsado, rebaja, motivoRebaja } = devolucionesDelPedido(devoluciones);
  const opciones = opcionesImporteReal({ total, envio, base, reembolsado, cobrado });
  const actual = Math.max(opciones.maximo - rebaja, 0);

  const [abierto, setAbierto] = useState(false);
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");

  const abrir = () => {
    setImporte(conComa(actual));
    setMotivo("");
    setAbierto(true);
  };
  const usar = (valor: number, texto: string) => {
    setImporte(conComa(valor));
    if (!motivo.trim()) setMotivo(texto);
  };

  const leido = leerNumeroEscrito(importe);
  const valido = Number.isFinite(leido) && leido >= 0 && leido <= opciones.maximo;

  const guardar = useMutation({
    mutationFn: () =>
      ajustar({ data: { pedido_id: pedidoId, importe_real: leido, motivo: motivo.trim() } }),
    onSuccess: (r) => {
      toast.success(
        r.rebaja > 0
          ? `Importe real guardado: ${eur(opciones.maximo - r.rebaja)} (rebaja de ${eur(r.rebaja)})`
          : "Rebaja quitada: el pedido vuelve a su total",
      );
      setAbierto(false);
      qc.invalidateQueries();
    },
    onError: (e) => avisarError(e, "No se ha podido guardar el importe real"),
  });

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Importe real</div>
          {rebaja > 0 ? (
            <div>
              <span className="font-semibold tabular-nums">{eur(actual)}</span>{" "}
              <span className="text-muted-foreground">
                (rebaja de {eur(rebaja)}
                {motivoRebaja ? ` · ${motivoRebaja.replace(/^Rebaja:\s*/, "")}` : ""})
              </span>
            </div>
          ) : (
            <div className="text-muted-foreground">
              El total del pedido. ¿No es lo que de verdad se vende?
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={abrir}>
          <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
          Ajustar importe
        </Button>
      </div>
    );
  }

  return (
    <FormularioDialogo
      className="block space-y-3 rounded-md border p-3"
      alEnviar={() => valido && motivo.trim() && guardar.mutate()}
      ocupado={guardar.isPending}
    >
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Importe real del pedido
      </Label>
      <p className="text-xs text-muted-foreground">
        Lo que de verdad se vende, con IVA. La diferencia con el total ({eur(opciones.maximo)})
        queda como rebaja: baja la venta y lo pendiente. La web no se toca.
      </p>
      {(opciones.sinEnvio !== null || opciones.loCobrado !== null) && (
        <div className="flex flex-wrap gap-2">
          {opciones.sinEnvio !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => usar(opciones.sinEnvio!, "recogió en el local, sin envío")}
            >
              Sin envío · {eur(opciones.sinEnvio)}
            </Button>
          )}
          {opciones.loCobrado !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => usar(opciones.loCobrado!, "precio acordado: lo cobrado")}
            >
              Lo cobrado · {eur(opciones.loCobrado)}
            </Button>
          )}
          {rebaja > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => usar(opciones.maximo, "sin rebaja")}
            >
              Quitar la rebaja · {eur(opciones.maximo)}
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="importe-real">Importe real (€, con IVA)</Label>
          <Input
            id="importe-real"
            inputMode="decimal"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            aria-invalid={importe.trim() !== "" && !valido}
          />
          {importe.trim() !== "" && !valido && (
            <p className="text-xs text-destructive">
              Entre 0 y {eur(opciones.maximo)}, por ejemplo «8,47».
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="motivo-rebaja">Motivo</Label>
          <Input
            id="motivo-rebaja"
            value={motivo}
            maxLength={200}
            placeholder="Por ejemplo: recogió en el local"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valido || !motivo.trim() || guardar.isPending}>
          {guardar.isPending ? "Guardando…" : "Guardar importe real"}
        </Button>
      </div>
    </FormularioDialogo>
  );
}
