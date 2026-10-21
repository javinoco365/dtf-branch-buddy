import type { ReactNode } from "react";
import { usePermisos } from "@/hooks/use-permisos";

/**
 * Deja los campos y botones de dentro desactivados si quien está dentro no
 * puede escribir (el visor). Sirve para enseñarle un formulario entero (un
 * pedido con sus líneas, unos ajustes) sin que nada se pueda cambiar ni
 * pulsar:
 *
 *   <CamposSegunNivel>
 *     <Input ... />
 *     <LineasEditor ... />
 *   </CamposSegunNivel>
 *
 * Es un <fieldset disabled>: el navegador desactiva todos los controles de
 * dentro (inputs, selects, botones, también los de Radix, que son botones),
 * sin tocar cada uno. `display: contents` para que no cambie la maquetación.
 * El botón de guardar va fuera y se oculta aparte. Es solo interfaz: la base
 * no deja escribir a un visor por ningún camino.
 */
export function CamposSegunNivel({ children }: { children: ReactNode }) {
  const { escribir } = usePermisos();
  return (
    <fieldset disabled={!escribir} className="contents">
      {children}
    </fieldset>
  );
}
