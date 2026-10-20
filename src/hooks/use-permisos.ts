import { useMemo } from "react";
import { permisosDe, type Permisos } from "@/dominio/permisos";
import { useAuth } from "@/lib/auth-context";

/**
 * Qué puede hacer quien está dentro, para enseñar u ocultar botones:
 *
 *   const { escribir, borrar, gestionarUsuarios } = usePermisos();
 *   {escribir && <Button>Nuevo</Button>}
 *
 * Es solo la interfaz. La seguridad está en la base (políticas, guardia y
 * funciones SECURITY DEFINER) y en los middlewares de las server functions
 * (src/lib/permisos-middleware.ts).
 */
export function usePermisos(): Permisos & { cargando: boolean } {
  const { nivel, loading } = useAuth();
  return useMemo(() => ({ ...permisosDe(nivel), cargando: loading }), [nivel, loading]);
}
