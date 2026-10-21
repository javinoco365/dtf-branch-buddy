import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Moon, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { fijarRealizadoPedido } from "@/lib/pedidos.functions";
import {
  fueraDeHora,
  horaDelPedido,
  instanteDeRelojEspana,
  momentoDeInstante,
  realizadoOtroDia,
} from "@/dominio/realizado";
import type { FechaPedido } from "@/dominio/dia-pedido";
import { avisarError } from "@/lib/errores";

/** '20/10 · 09:15' de 'yyyy-mm-ddThh:mm:ss'. */
const corto = (momento: string) =>
  `${momento.slice(8, 10)}/${momento.slice(5, 7)} · ${momento.slice(11, 16)}`;

/**
 * La hora a la que entró el pedido y, si fue a la hora de corte o después,
 * una luna: se hace al día siguiente.
 */
export function HoraPedido({ pedido, horaCorte }: { pedido: FechaPedido; horaCorte: string }) {
  const hora = horaDelPedido(pedido);
  if (!hora) return null;
  const tarde = fueraDeHora(pedido, horaCorte);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        tarde ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground",
      )}
      title={
        tarde
          ? `Entró a las ${hora}, después del corte (${horaCorte}): se hace al día siguiente`
          : `Entró a las ${hora}`
      }
    >
      {hora}
      {tarde && <Moon className="h-3 w-3" aria-label="fuera de hora" />}
    </span>
  );
}

const HECHOS = new Set(["enviado", "entregado", "cancelado"]);

/**
 * Debajo del estado, en pequeño, cuándo se realizó: «✓ 20/10 · 09:15». En
 * azul si fue otro día que el del pedido. Un administrador lo corrige con un
 * clic (lo imprimisteis ayer y lo marcasteis hoy).
 */
export function RealizadoEn({
  tabla,
  pedido,
}: {
  tabla: "pedidos" | "textil_pedidos";
  pedido: FechaPedido & { id: string; estado: string; realizado_en?: string | null };
}) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const fijarFn = useServerFn(fijarRealizadoPedido);
  const [abierto, setAbierto] = useState(false);
  const momento = momentoDeInstante(pedido.realizado_en);
  const [valor, setValor] = useState("");

  const guardar = useMutation({
    mutationFn: (realizado_en: string) => fijarFn({ data: { tabla, id: pedido.id, realizado_en } }),
    onSuccess: () => {
      toast.success("Fecha de realizado corregida");
      setAbierto(false);
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["textil-pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["gerencia"] });
    },
    onError: (e: Error) => avisarError(e, "No se pudo corregir la fecha"),
  });

  // Solo los pedidos ya realizados (o cancelados después) llevan fecha.
  if (!HECHOS.has(pedido.estado)) return null;
  if (!momento && pedido.estado === "cancelado") return null;

  const otroDia = realizadoOtroDia(pedido);
  const texto = momento ? corto(momento) : "sin fecha";
  const etiqueta = (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] leading-tight tabular-nums",
        !momento
          ? "text-muted-foreground italic"
          : otroDia
            ? "font-medium text-primary"
            : "text-muted-foreground",
      )}
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      {texto}
      {isAdmin && <Pencil className="h-2.5 w-2.5 opacity-50" />}
    </span>
  );
  const titulo = momento
    ? `Realizado el ${corto(momento)}${otroDia ? " (otro día que el del pedido)" : ""}`
    : "Realizado, sin fecha registrada";

  if (!isAdmin) return <span title={titulo}>{etiqueta}</span>;

  return (
    <Popover
      open={abierto}
      onOpenChange={(o) => {
        setAbierto(o);
        if (o) setValor(momento?.slice(0, 16) ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block text-left hover:underline"
          title={`${titulo}. Clic para corregir`}
        >
          {etiqueta}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`realizado-${pedido.id}`}>Realizado el (hora de España)</Label>
          <Input
            id={`realizado-${pedido.id}`}
            type="datetime-local"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            El día en que se imprimió de verdad. Cuenta para los metros realizados de ese día.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={guardar.isPending || !instanteDeRelojEspana(valor)}
            onClick={() => {
              const iso = instanteDeRelojEspana(valor);
              if (iso) guardar.mutate(iso);
            }}
          >
            {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
