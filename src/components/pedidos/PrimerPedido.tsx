import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SiPuede } from "@/components/SiPuede";
import { supabase } from "@/integrations/supabase/client";
import { llamarRpcConError } from "@/lib/rpc";
import { CLAVE_PRIMER_PEDIDO as CLAVE, type OrigenPedido } from "@/hooks/use-primer-pedido";
import { decidirPrimerPedido } from "@/lib/primer-pedido.functions";
import { avisarError } from "@/lib/errores";
import { fechaCorta } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  etiquetaPrimerPedido,
  textoMotivos,
  type DecisionPrimerPedido,
  type ResumenPrimerPedido,
} from "@/dominio/primer-pedido";

/**
 * «1.er pedido» junto al nombre del cliente. Si solo coincide el nombre con
 * pedidos anteriores, sale con «?» y se puede pulsar: enseña esos pedidos y
 * deja decidir si es cliente nuevo o no. Ya decidido, se puede pulsar para
 * cambiarlo.
 */
export function EtiquetaPrimerPedido({
  origen,
  id,
  resumen,
  className,
}: {
  origen: OrigenPedido;
  id: string;
  resumen: ResumenPrimerPedido | undefined;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const etiqueta = etiquetaPrimerPedido(resumen);
  // «Ya era cliente» decidido a mano: no hay etiqueta, pero sí forma de
  // deshacerlo desde la misma fila.
  const repiteDecidido = resumen?.decision === "repite";
  if (!etiqueta && !repiteDecidido) return null;

  const dudoso = etiqueta?.tipo === "dudoso";
  const pulsable = dudoso || !!resumen?.decision;
  const texto = etiqueta ? (dudoso ? "¿1.er pedido?" : "1.er pedido") : "Ya era cliente";
  const titulo = dudoso
    ? `Hay ${etiqueta.parecidos} pedido${etiqueta.parecidos === 1 ? "" : "s"} anterior${
        etiqueta.parecidos === 1 ? "" : "es"
      } con el mismo nombre. Pulsa para verlos y decidir.`
    : resumen?.decision
      ? "Lo decidió una persona. Pulsa para verlo o cambiarlo."
      : "Primer pedido de este cliente en toda la empresa.";

  const clases = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0 text-[11px] font-medium leading-5",
    dudoso
      ? "border-status-pendiente/30 bg-status-pendiente/10 text-status-pendiente"
      : etiqueta
        ? "border-status-completado/25 bg-status-completado/10 text-status-completado"
        : "border-border bg-muted text-muted-foreground",
    pulsable && "cursor-pointer hover:underline",
    className,
  );

  return (
    <>
      {pulsable ? (
        <button
          type="button"
          className={clases}
          title={titulo}
          onClick={(e) => {
            // Dentro de una fila que se despliega al pulsarla.
            e.stopPropagation();
            setAbierto(true);
          }}
        >
          {etiqueta && <Sparkles className="h-3 w-3" aria-hidden />}
          {texto}
        </button>
      ) : (
        <span className={clases} title={titulo}>
          <Sparkles className="h-3 w-3" aria-hidden />
          {texto}
        </span>
      )}
      {abierto && (
        <DecidirPrimerPedido
          origen={origen}
          id={id}
          decision={resumen?.decision ?? null}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </>
  );
}

type Parecido = {
  origen: OrigenPedido;
  id: string;
  procedencia: string | null;
  numero: string;
  fecha: string;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  motivos: string[];
  fuerte: boolean;
};

/** Los pedidos anteriores que se parecen, y los botones para decidir. */
function DecidirPrimerPedido({
  origen,
  id,
  decision,
  onCerrar,
}: {
  origen: OrigenPedido;
  id: string;
  decision: DecisionPrimerPedido | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const decidirFn = useServerFn(decidirPrimerPedido);

  const { data: parecidos = [], isLoading } = useQuery({
    queryKey: [CLAVE, "parecidos", origen, id],
    queryFn: async () => {
      const { data, error } = await llamarRpcConError<Parecido[]>(
        supabase,
        "primer_pedido_parecidos",
        { _origen: origen, _id: id },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const decidir = useMutation({
    mutationFn: (d: DecisionPrimerPedido | null) =>
      decidirFn({ data: { origen, id, decision: d } }),
    onSuccess: (_r, d) => {
      qc.invalidateQueries({ queryKey: [CLAVE] });
      toast.success(
        d === "nuevo"
          ? "Marcado como cliente nuevo"
          : d === "repite"
            ? "Marcado como cliente que ya había comprado"
            : "Vuelve a decidir la regla",
      );
      onCerrar();
    },
    onError: (e) => avisarError(e, "No se pudo guardar"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !decidir.isPending && onCerrar()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>¿Es su primer pedido?</DialogTitle>
          <DialogDescription>
            Estos pedidos anteriores se parecen a este cliente. Si alguno es suyo, ya era cliente.
            {decision === "nuevo" && " Ahora está marcado como cliente nuevo."}
            {decision === "repite" && " Ahora está marcado como cliente que ya había comprado."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Buscando pedidos parecidos…</p>
        ) : parecidos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay pedidos anteriores que se parezcan.
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {parecidos.map((p) => (
              <li key={`${p.origen}-${p.id}`} className="space-y-0.5 p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs">{p.numero}</span>
                  <span className="text-xs text-muted-foreground">
                    {fechaCorta(p.fecha)} · {p.procedencia ?? "—"}
                  </span>
                </div>
                <div className="font-medium">{p.nombre ?? "—"}</div>
                {(p.email || p.telefono) && (
                  <div className="text-xs text-muted-foreground">
                    {[p.email, p.telefono].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div
                  className={cn(
                    "text-xs",
                    p.fuerte ? "text-status-completado" : "text-status-pendiente",
                  )}
                >
                  {textoMotivos(p.motivos)}
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <SiPuede accion="escribir">
            {decision ? (
              <Button
                variant="ghost"
                onClick={() => decidir.mutate(null)}
                disabled={decidir.isPending}
              >
                Quitar la decisión
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => decidir.mutate("repite")}
                disabled={decidir.isPending || decision === "repite"}
              >
                Ya era cliente
              </Button>
              <Button
                onClick={() => decidir.mutate("nuevo")}
                disabled={decidir.isPending || decision === "nuevo"}
              >
                Es cliente nuevo
              </Button>
            </div>
          </SiPuede>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
