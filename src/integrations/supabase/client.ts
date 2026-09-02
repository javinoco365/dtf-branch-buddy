// Fichero originalmente generado por Lovable. Lovable está congelado desde la
// fase 1, así que se edita aquí: la lectura de configuración se ha movido a
// src/lib/config-publica.ts para que el navegador pueda recibir las claves del
// servidor en tiempo de ejecución y no solo del bundle compilado.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";
import { leerConfigPublica } from "@/lib/config-publica";

function createSupabaseClient() {
  let config;
  try {
    config = leerConfigPublica();
  } catch (error) {
    console.error(`[Supabase] ${(error as Error).message}`);
    throw error;
  }

  return createClient<Database>(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
