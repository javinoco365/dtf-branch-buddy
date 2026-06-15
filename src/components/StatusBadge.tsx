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
  procesando: "bg-[oklch(0.65_0.15_235/0.15)] text-[oklch(0.45_0.15_235)]",
  pagada: "bg-[oklch(0.65_0.16_150/0.15)] text-[oklch(0.40_0.16_150)]",
  completado: "bg-[oklch(0.65_0.16_150/0.15)] text-[oklch(0.40_0.16_150)]",
  emitida: "bg-[oklch(0.65_0.15_235/0.15)] text-[oklch(0.45_0.15_235)]",
  pendiente: "bg-[oklch(0.78_0.15_80/0.20)] text-[oklch(0.45_0.15_70)]",
  borrador: "bg-muted text-muted-foreground",
  cancelado: "bg-[oklch(0.60_0.22_27/0.15)] text-[oklch(0.50_0.22_27)]",
  anulada: "bg-[oklch(0.60_0.22_27/0.15)] text-[oklch(0.50_0.22_27)]",
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
