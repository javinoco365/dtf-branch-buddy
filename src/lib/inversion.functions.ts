import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tabla } from "./rpc";
import type { TipoInversion } from "@/dominio/inversion";

/**
 * La inversión de los socios.
 *
 * Los socios son los mismos que los de caja: se leen con
 * `listarCatalogosCaja`, no hay una segunda lista. El nombre congelado lo pone
 * el trigger `inversion_congelar()`, y los totales se calculan en
 * `src/dominio/inversion.ts`. Aquí solo se lee y se escribe.
 */

async function empresaActiva(supabase: unknown): Promise<string> {
  const { data } = await tabla(supabase, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data?.id) throw new Error("No hay ninguna empresa activa configurada");
  return data.id as string;
}

export type MovimientoInversion = {
  id: string;
  fecha: string;
  socio_id: string;
  socio_nombre: string;
  tipo: TipoInversion;
  importe: number;
  observaciones: string | null;
};

/**
 * Todos los apuntes, sin filtro de fechas.
 *
 * A diferencia de la caja, aquí no se acota por periodo: la inversión es un
 * acumulado desde el principio y ver «lo aportado este año» no significa nada.
 */
export const listarInversion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tabla(context.supabase, "inversion_movimientos")
      .select("*")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { movimientos: (data ?? []) as MovimientoInversion[] };
  });

export const guardarInversion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        fecha: z.string().min(1, "La fecha es obligatoria"),
        socio_id: z.string().uuid("Elige un socio"),
        tipo: z.enum(["aportacion", "retirada"]),
        importe: z.number().positive("El importe tiene que ser mayor que cero"),
        observaciones: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const empresa_id = await empresaActiva(supabaseAdmin);

    const fila = {
      empresa_id,
      fecha: data.fecha,
      socio_id: data.socio_id,
      // La columna es NOT NULL y el trigger la sobrescribe con el nombre real.
      socio_nombre: "",
      tipo: data.tipo,
      importe: data.importe,
      observaciones: data.observaciones?.trim() || null,
    };

    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "inversion_movimientos")
        .update(fila)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: creado, error } = await tabla(supabaseAdmin, "inversion_movimientos")
      .insert(fila)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: creado.id as string };
  });

export const borrarInversion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { error } = await tabla(supabaseAdmin, "inversion_movimientos")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
