import { supabase } from "@/integrations/supabase/client";
import { tabla } from "./rpc";

/**
 * La sociedad. Hay una sola: RONOCA DESARROLLOS S.L.
 *
 * Existía una segunda tabla, empresa_global, que era la que editaba la pantalla
 * de Configuración mientras que emitir_factura() sacaba el emisor de empresas.
 * Es decir: lo que se escribía en Configuración no llegaba a las facturas.
 * empresa_global quedó obsoleta en 20260903100000 y nadie debe volver a leerla.
 */
export const CLAVE_EMPRESA = ["empresa"] as const;

export type Empresa = {
  id: string;
  razon_social: string | null;
  cif: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string | null;
  email_fiscal: string | null;
  telefono: string | null;
  serie_factura: string | null;
  serie_rectificativa: string | null;
  coste_consumibles_metro: number | null;
  coste_packaging_metro: number | null;
  coste_electricidad_metro: number | null;
  textil_marca_predeterminada_id: string | null;
};

export async function leerEmpresa(): Promise<Empresa | null> {
  const { data, error } = await tabla(supabase, "empresas")
    .select("*")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Empresa | null) ?? null;
}

export async function guardarEmpresa(id: string, campos: Record<string, unknown>) {
  const { error } = await tabla(supabase, "empresas").update(campos).eq("id", id);
  if (error) throw error;
}
