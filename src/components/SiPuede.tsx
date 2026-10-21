import type { ReactNode } from "react";
import type { Accion } from "@/dominio/permisos";
import { usePermisos } from "@/hooks/use-permisos";

/**
 * Enseña sus hijos solo si quien está dentro puede hacer la acción:
 *
 *   <SiPuede accion="borrar"><Button>Borrar</Button></SiPuede>
 *
 * «escribir» = crear y modificar (admin y editor); «borrar» y «admin», solo
 * admin. Es interfaz: la base y las server functions lo comprueban igual.
 */
export function SiPuede({ accion, children }: { accion: Accion; children: ReactNode }) {
  const p = usePermisos();
  const ok =
    accion === "escribir" ? p.escribir : accion === "borrar" ? p.borrar : p.gestionarUsuarios;
  return ok ? <>{children}</> : null;
}
