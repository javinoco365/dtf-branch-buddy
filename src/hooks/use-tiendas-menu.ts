import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { tabla } from "@/lib/rpc";
import { useAuth } from "@/lib/auth-context";

export interface TiendaMenu {
  id: string;
  nombre: string;
  color: string | null;
}

/**
 * Las tiendas activas, para el menú lateral y para el título de la cabecera
 * («Tienda Uno › Facturas»). Las dos usan la misma consulta, así que se pide
 * una vez.
 */
export function useTiendasMenu() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tiendas-sidebar", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Una tienda desactivada desaparece del día a día. Sigue existiendo, y
      // se vuelve a activar desde la lista de tiendas.
      //
      // El filtro se hace aquí y no en la consulta a propósito. Nombrar la
      // columna `activa` en el select o en un .eq() hace que PostgREST
      // devuelva error mientras la migración que la añade no esté aplicada, y
      // ese error dejaba el menú de tiendas VACÍO sin decir por qué: parecía
      // que no había tiendas cuando lo que faltaba era una columna. Con
      // select("*") la consulta funciona antes y después, y una tienda sin el
      // campo se trata como activa.
      const { data, error } = await tabla(supabase, "tiendas").select("*").order("nombre");
      if (error) throw error;
      return ((data ?? []) as { activa?: boolean }[]).filter(
        (t) => t.activa !== false,
      ) as TiendaMenu[];
    },
  });
}
