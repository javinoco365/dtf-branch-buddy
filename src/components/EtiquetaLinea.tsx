import { cn } from "@/lib/utils";
import { lineasDelPedido } from "@/dominio/linea-producto";

/**
 * La marca del DTF UV: un pedido o una línea de UV se reconoce de un vistazo
 * en cualquier lista. Morado para que no se confunda con ningún estado.
 */
export function EtiquetaUv({ className, texto = "UV" }: { className?: string; texto?: string }) {
  return (
    <span
      title="DTF UV (subcontratado)"
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300",
        className,
      )}
    >
      {texto}
    </span>
  );
}

/**
 * La etiqueta de un pedido por lo que lleva: «UV» si es solo de UV, «DTF +
 * UV» si es mixto y nada si es solo DTF (lo de siempre no se marca).
 */
export function EtiquetaLineasPedido({
  pedido,
  className,
}: {
  pedido: { metros_total?: number | string | null; metros_uv?: number | string | null };
  className?: string;
}) {
  const lineas = lineasDelPedido(pedido);
  if (lineas === "uv") return <EtiquetaUv className={className} />;
  if (lineas === "mixto") return <EtiquetaUv className={className} texto="DTF + UV" />;
  return null;
}
