// Fichero originalmente generado por Lovable. Lovable está congelado desde la
// fase 1, así que se edita aquí.
//
// Cliente de servidor con la clave de servicio: salta la RLS. Solo para
// operaciones de confianza en server functions y rutas de servidor. Para
// consultas del usuario (con RLS), usa context.supabase del middleware de
// autenticación.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseAdminClient(cabeceras?: Record<string, string>) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.DTI_SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: cabeceras ? { headers: cabeceras } : undefined,
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
// Top-level import is safe only in other .server.ts modules - route files and *.functions.ts ship to the client bundle.
//
// Este cliente escribe SIN AUTOR: la clave de servicio no lleva JWT de usuario,
// así que auth.uid() es NULL y la auditoría registra el cambio como anónimo.
// Úsalo solo para lecturas y para escrituras que de verdad no tienen autor
// (webhooks, sincronizaciones automáticas). Si hay un usuario detrás, usa
// adminComoUsuario().
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El mismo cliente de servicio, pero diciendo quién está detrás.
//
// La cabecera x-usuario-id la lee auditoria_autor() en la base de datos, que
// solo la acepta con rol de servicio y solo si no hay un auth.uid() mejor.
// PostgREST la expone en request.headers con SET LOCAL, dentro de la misma
// transacción de la escritura, así que no se queda pegada a la conexión del
// pool ni contamina la siguiente petición. Ver
// supabase/migrations/20260902140000_auditoria_autor_servicio.sql.
//
// Se valida el UUID antes de ponerlo en una cabecera HTTP: context.userId sale
// del JWT y siempre lo es, pero una cabecera se construye una vez y se manda
// muchas, y no se meten cadenas sin comprobar en una.
export function adminComoUsuario(usuarioId: string) {
  if (!UUID.test(usuarioId)) {
    throw new Error(`Identificador de usuario no válido: ${JSON.stringify(usuarioId)}`);
  }
  return createSupabaseAdminClient({ "x-usuario-id": usuarioId });
}
