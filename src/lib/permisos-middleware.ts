// Middlewares de nivel para las server functions que escriben.
//
// Sustituyen a requireSupabaseAuth en `.middleware([...])`: lo incluyen (la
// sesión se comprueba igual y el contexto trae userId y supabase) y después
// comprueban el nivel del usuario con mi_nivel(), antes de que el handler
// toque nada. Así una server function que escribe con supabaseAdmin o
// adminComoUsuario no depende solo de la base para frenar a un visor.
//
// La seguridad de verdad sigue en la base (políticas, guardia y funciones
// SECURITY DEFINER, migraciones 20261031200000 a 20261031200300): esto da un
// error claro antes y evita trabajo (llamadas a WooCommerce, PDF, IA) que
// luego la base rechazaría.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeSinPermiso, puede, type Accion } from "@/dominio/permisos";
import { leerMiNivel } from "./nivel-sesion";

function exige(accion: Accion) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      // Con el cliente del usuario: mi_nivel() lee auth.uid() de su JWT.
      const nivel = await leerMiNivel(context.supabase, context.userId);
      if (!puede(nivel, accion)) throw new Error(mensajeSinPermiso(accion, nivel));
      return next({ context: { nivel } });
    });
}

/** Crear y modificar: admin y editor. */
export const exigeEscribir = exige("escribir");

/** Borrar: solo admin. */
export const exigeBorrar = exige("borrar");

/** Gestión (usuarios, credenciales, correo, tiendas): solo admin. */
export const exigeAdmin = exige("admin");
