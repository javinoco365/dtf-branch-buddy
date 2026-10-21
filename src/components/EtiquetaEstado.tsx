import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { infoEstado, type TipoEstado, type TonoEstado } from "@/dominio/estados";

/**
 * Los colores de cada tono, con las variantes «tinta» de la paleta, que son las
 * que se leen como texto pequeño sobre fondo claro (4,6:1 o más). Un punto del
 * mismo color delante ayuda a recorrer una columna de un vistazo.
 */
const COLOR: Record<TonoEstado, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  en_curso: "border-status-procesando/25 bg-status-procesando/10 text-status-procesando",
  atencion: "border-status-pendiente/30 bg-status-pendiente/10 text-status-pendiente",
  bien: "border-status-completado/25 bg-status-completado/10 text-status-completado",
  mal: "border-status-cancelado/25 bg-status-cancelado/10 text-status-cancelado",
};

/**
 * Un estado con su nombre y su color, el mismo en toda la aplicación (la regla
 * está en `src/dominio/estados.ts`).
 */
export function EtiquetaEstado({
  tipo,
  valor,
  className,
}: {
  tipo: TipoEstado;
  valor: string | null | undefined;
  className?: string;
}) {
  const { etiqueta, tono } = infoEstado(tipo, valor);
  return (
    <EtiquetaTono tono={tono} className={className}>
      {etiqueta}
    </EtiquetaTono>
  );
}

/**
 * La misma etiqueta con un texto propio, para lo que no es un estado de la
 * base pero se lee igual: «Confianza 92 %», «Sin fichero».
 */
export function EtiquetaTono({
  tono,
  className,
  children,
}: {
  tono: TonoEstado;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        COLOR[tono],
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
