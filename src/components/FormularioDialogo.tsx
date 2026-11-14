import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * El formulario de un diálogo: Intro en un campo (o «Ir» en el teclado del
 * móvil) hace lo mismo que el botón principal, que lleva `type="submit"`.
 *
 * - En un textarea, Intro sigue siendo un salto de línea: el navegador no
 *   envía el formulario desde ahí.
 * - No envía dos veces: mientras `ocupado` (la mutación en curso) o mientras
 *   la promesa que devuelve `alEnviar` no ha terminado, otro Intro no hace nada.
 * - No sube a un formulario de fuera: el diálogo va en un portal, pero React
 *   propaga el evento por el árbol de componentes.
 *
 * Va justo después de <DialogHeader> y envuelve el cuerpo y el <DialogFooter>;
 * repite la rejilla del diálogo para que nada cambie de sitio.
 */
export function FormularioDialogo({
  alEnviar,
  ocupado = false,
  className,
  children,
}: {
  alEnviar: () => unknown;
  ocupado?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const enviando = useRef(false);
  return (
    <form
      noValidate
      className={cn("grid min-w-0 gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (ocupado || enviando.current) return;
        const resultado = alEnviar();
        if (resultado instanceof Promise) {
          enviando.current = true;
          resultado
            .catch(() => {
              // El error ya lo enseña quien envía (avisarError); aquí solo se
              // libera el formulario.
            })
            .finally(() => {
              enviando.current = false;
            });
        }
      }}
    >
      {children}
    </form>
  );
}
