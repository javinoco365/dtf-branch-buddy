import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { eur, fechaCorta } from "@/lib/format";
import {
  emitirFacturasPedidos,
  emitirTicketsPedidos,
  pedidosParaFacturar,
  rellenarPdfsTienda,
  type PedidoParaFacturar,
} from "@/lib/facturas.functions";

type Modo = "ticket" | "factura";

/** De cuántos en cuántos se emite: muchos de una vez se pasarían del tiempo de una función. */
const TANDA = 20;

type Resultado = {
  emitidos: { pedido: string; referencia: string; id: string; nota?: string }[];
  omitidos: { pedido: string; motivo: string }[];
};

/**
 * «Facturar» desde la lista de pedidos: se elige ticket o factura, se marcan
 * los pedidos y se emiten del más antiguo al más nuevo, cada uno con la fecha
 * de su pedido (si la serie ya va por delante, con la del último documento y
 * la del pedido como fecha de la operación).
 *
 * Lo que se enseña es una vista previa; al emitir, el servidor vuelve a
 * comprobarlo todo pedido a pedido.
 */
export function FacturarPedidosDialog({
  open,
  onOpenChange,
  pedidoIds,
  recortados,
  nombreTienda,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Los pedidos sin documento de lo que se está viendo, como mucho 500. */
  pedidoIds: string[];
  /** Cuántos se han quedado fuera por pasar de 500. */
  recortados: number;
  /** Para la vista de todas las tiendas: el nombre de la tienda de cada pedido. */
  nombreTienda?: (tiendaId: string) => string | null;
}) {
  const qc = useQueryClient();
  const previaFn = useServerFn(pedidosParaFacturar);
  const ticketsFn = useServerFn(emitirTicketsPedidos);
  const facturasFn = useServerFn(emitirFacturasPedidos);
  const rellenarFn = useServerFn(rellenarPdfsTienda);

  const [modo, setModo] = useState<Modo>("ticket");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [emitiendo, setEmitiendo] = useState<{ hechos: number; total: number } | null>(null);
  const [pdfs, setPdfs] = useState<{ hechos: number; total: number; fallidos: number } | null>(
    null,
  );
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const clave = ["pedidos-para-facturar", [...pedidoIds].sort().join(",")];
  const { data, isLoading, error } = useQuery({
    queryKey: clave,
    queryFn: () => previaFn({ data: { pedido_ids: pedidoIds } }),
    enabled: open && pedidoIds.length > 0,
  });
  const pedidos = useMemo(() => (data ?? []) as PedidoParaFacturar[], [data]);
  const motivo = (p: PedidoParaFacturar) => (modo === "ticket" ? p.ticket : p.factura);
  const posibles = useMemo(
    () => pedidos.filter((p) => (modo === "ticket" ? p.ticket : p.factura) === null),
    [pedidos, modo],
  );

  // Al cambiar de ticket a factura, se desmarcan los que ya no se pueden.
  useEffect(() => {
    setMarcados((m) => new Set([...m].filter((id) => posibles.some((p) => p.id === id))));
  }, [posibles]);

  useEffect(() => {
    if (open) return;
    setMarcados(new Set());
    setResultado(null);
    setPdfs(null);
    setEmitiendo(null);
  }, [open]);

  const todos = posibles.length > 0 && posibles.every((p) => marcados.has(p.id));
  const seleccion = pedidos.filter((p) => marcados.has(p.id));
  const importe = seleccion.reduce((s, p) => s + p.total, 0);
  const nombreDoc = (n: number) =>
    modo === "ticket" ? (n === 1 ? "ticket" : "tickets") : n === 1 ? "factura" : "facturas";

  function alternar(id: string, si: boolean) {
    setMarcados((m) => {
      const n = new Set(m);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function emitir() {
    // En orden de fecha: la numeración no puede ir hacia atrás.
    const ids = seleccion.map((p) => p.id);
    if (!ids.length) return;
    const acumulado: Resultado = { emitidos: [], omitidos: [] };
    setEmitiendo({ hechos: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += TANDA) {
        const lote = ids.slice(i, i + TANDA);
        const r =
          modo === "ticket"
            ? await ticketsFn({ data: { pedido_ids: lote } })
            : await facturasFn({ data: { pedido_ids: lote } });
        acumulado.emitidos.push(...r.emitidos);
        acumulado.omitidos.push(...r.omitidos);
        setEmitiendo({ hechos: Math.min(i + TANDA, ids.length), total: ids.length });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron emitir");
    }
    setEmitiendo(null);
    setResultado(acumulado);
    if (acumulado.emitidos.length) {
      toast.success(
        `${acumulado.emitidos.length} ${nombreDoc(acumulado.emitidos.length)} emitido(s)`,
      );
    }
    if (acumulado.omitidos.length) {
      toast.warning(`${acumulado.omitidos.length} pedido(s) no se han emitido`);
    }
    qc.invalidateQueries({ queryKey: ["pedidos"] });
    qc.invalidateQueries({ queryKey: ["pedidos-para-facturar"] });
    await guardarPdfs(acumulado.emitidos.map((e) => e.id));
    qc.invalidateQueries({ queryKey: ["facturas"] });
  }

  /**
   * El PDF de cada documento, de diez en diez, después de emitirlos. Si alguno
   * falla, el documento ya está emitido: su PDF se genera al abrirlo.
   */
  async function guardarPdfs(ids: string[]) {
    if (!ids.length) return;
    let hechos = 0;
    let fallidos = 0;
    setPdfs({ hechos, total: ids.length, fallidos });
    for (let i = 0; i < ids.length; i += 10) {
      const lote = ids.slice(i, i + 10);
      try {
        const r = await rellenarFn({ data: { ids: lote, limite: 10 } });
        fallidos += r.fallidos.length;
      } catch {
        fallidos += lote.length;
      }
      hechos += lote.length;
      setPdfs({ hechos, total: ids.length, fallidos });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !emitiendo && onOpenChange(o)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Facturar pedidos</DialogTitle>
          <DialogDescription>
            Elige ticket o factura y marca los pedidos. Se emiten del más antiguo al más nuevo, cada
            uno con la fecha de su pedido.
          </DialogDescription>
        </DialogHeader>

        {!resultado && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={modo === "ticket" ? "default" : "outline"}
              onClick={() => setModo("ticket")}
              aria-pressed={modo === "ticket"}
              disabled={!!emitiendo}
            >
              <Receipt className="mr-2 h-4 w-4" /> Tickets
            </Button>
            <Button
              size="sm"
              variant={modo === "factura" ? "default" : "outline"}
              onClick={() => setModo("factura")}
              aria-pressed={modo === "factura"}
              disabled={!!emitiendo}
            >
              <FileText className="mr-2 h-4 w-4" /> Facturas
            </Button>
            <span className="text-xs text-muted-foreground">
              {modo === "ticket"
                ? "Sin NIF y dentro del límite del ticket."
                : "Factura completa, con los datos del cliente del pedido."}
            </span>
          </div>
        )}

        {pedidoIds.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay pedidos sin ticket ni factura en lo que estás viendo.
          </p>
        )}
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Leyendo…</p>}
        {error && (
          <p className="py-6 text-center text-sm text-destructive">
            {(error as Error).message || "No se pudieron leer los pedidos"}
          </p>
        )}

        {resultado && (
          <div className="max-h-[55vh] space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
            {resultado.emitidos.length > 0 && (
              <p>
                Emitidos:{" "}
                {resultado.emitidos.map((e) => `${e.referencia} (${e.pedido})`).join(", ")}
              </p>
            )}
            {resultado.emitidos
              .filter((e) => e.nota)
              .map((e) => (
                <p key={`nota-${e.id}`} className="text-muted-foreground">
                  {e.referencia} ({e.pedido}): {e.nota}
                </p>
              ))}
            {pdfs && (
              <p className="text-muted-foreground">
                {pdfs.hechos < pdfs.total
                  ? `Guardando los PDF… ${pdfs.hechos} de ${pdfs.total}`
                  : pdfs.fallidos
                    ? `PDF guardados: ${pdfs.total - pdfs.fallidos} de ${pdfs.total}. Los que faltan se generan al abrirlos.`
                    : `PDF guardados: ${pdfs.total}`}
              </p>
            )}
            {resultado.omitidos.map((o) => (
              <p key={o.pedido} className="text-status-pendiente">
                {o.pedido}: {o.motivo}
              </p>
            ))}
            {resultado.emitidos.length === 0 && resultado.omitidos.length === 0 && (
              <p className="text-muted-foreground">No se ha emitido nada.</p>
            )}
          </div>
        )}

        {!resultado && pedidos.length > 0 && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={todos}
                disabled={posibles.length === 0 || !!emitiendo}
                onCheckedChange={(v) =>
                  setMarcados(v ? new Set(posibles.map((p) => p.id)) : new Set())
                }
                aria-label="Marcar todos los que se pueden"
              />
              Marcar todos los que se pueden ({posibles.length} de {pedidos.length})
            </label>
            <div className="max-h-[50vh] divide-y overflow-y-auto rounded-md border text-sm">
              {pedidos.map((p) => {
                const no = motivo(p);
                const tienda = nombreTienda?.(p.tienda_id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-start gap-3 px-3 py-2 ${no ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={marcados.has(p.id)}
                      disabled={!!no || !!emitiendo}
                      onCheckedChange={(v) => alternar(p.id, !!v)}
                      aria-label={`Marcar ${p.numero}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="tabular-nums text-muted-foreground">
                          {fechaCorta(p.fecha)}
                        </span>
                        <span className="font-mono">{p.numero}</span>
                        {tienda && <span className="text-xs text-muted-foreground">{tienda}</span>}
                        <span className="min-w-0 truncate">{p.cliente_nombre || "Sin nombre"}</span>
                        {p.nif && <span className="text-xs text-muted-foreground">{p.nif}</span>}
                        <span className="ml-auto font-medium tabular-nums">{eur(p.total)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.cobrado + 0.005 >= p.total && p.total > 0
                          ? "Cobrado"
                          : p.cobrado > 0
                            ? `Cobrado ${eur(p.cobrado)}`
                            : "Sin cobrar"}
                        {no && <span className="text-status-pendiente"> · No: {no}</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {recortados > 0 && (
              <p className="text-xs text-muted-foreground">
                Hay {recortados} pedido(s) más en lo que estás viendo: acorta el periodo para
                verlos.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Un ticket o una factura emitidos no se pueden editar: solo rectificar, o borrar el
              último de su serie.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!emitiendo}>
            Cerrar
          </Button>
          {!resultado && (
            <Button onClick={emitir} disabled={!!emitiendo || seleccion.length === 0}>
              {emitiendo ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Emitiendo… {emitiendo.hechos} de {emitiendo.total}
                </>
              ) : seleccion.length ? (
                `Emitir ${seleccion.length} ${nombreDoc(seleccion.length)} · ${eur(importe)}`
              ) : (
                `Marca los pedidos`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
