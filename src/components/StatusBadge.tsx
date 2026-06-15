import { cn } from "@/lib/utils";

type Estado =
  | "procesando"
  | "completado"
  | "cancelado"
  | "pendiente"
  | "pagada"
  | "emitida"
  | "borrador"
  | "anulada"
  | string;

const styles: Record<string, string> = {
  procesando: "bg-status-procesando/15 text-status-procesando",
  pagada: "bg-status-completado/15 text-status-completado",
  completado: "bg-status-completado/15 text-status-completado",
  emitida: "bg-status-procesando/15 text-status-procesando",
  pendiente: "bg-status-pendiente/20 text-status-pendiente",
  borrador: "bg-muted text-muted-foreground",
  cancelado: "bg-status-cancelado/15 text-status-cancelado",
  anulada: "bg-status-cancelado/15 text-status-cancelado",
};

export function StatusBadge({ estado, className }: { estado: Estado; className?: string }) {
  const k = estado?.toLowerCase?.() ?? "";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[k] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {estado}
    </span>
  );
}
