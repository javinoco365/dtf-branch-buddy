import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tabla } from "./rpc";
import type { CategoriaCaja } from "@/dominio/caja";

/**
 * El libro de caja: efectivo y aportaciones de los socios.
 *
 * Aquí no se decide nada de negocio. La categoría del apunte y los nombres
 * congelados los pone el trigger `caja_movimiento_congelar()` leyendo el
 * concepto, el socio y el cliente; los totales se calculan en
 * `src/dominio/caja.ts`. Esta capa solo lee y escribe.
 *
 * Se manda `categoria` y `concepto_nombre` en el alta porque las dos columnas
 * son NOT NULL, pero lo que se guarda es lo que decide la base: si se mandara
 * «Nómina» como ingreso, el trigger lo corrige. Es a propósito.
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

export type ConceptoCaja = {
  id: string;
  nombre: string;
  categoria: CategoriaCaja;
  activo: boolean;
  orden: number;
};

export type SocioCaja = {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
};

export type MovimientoCaja = {
  id: string;
  fecha: string;
  categoria: CategoriaCaja;
  concepto_id: string;
  concepto_nombre: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  socio_id: string | null;
  socio_nombre: string | null;
  importe: number;
  observaciones: string | null;
};

/** Los conceptos y los socios, para los desplegables y para Ajustes. */
export const listarCatalogosCaja = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    // select("*") y filtrado aquí: nombrar una columna que la migración
    // todavía no haya aplicado haría fallar la consulta entera y la pantalla
    // se quedaría vacía sin decir por qué. Ya pasó con el menú de tiendas.
    const [{ data: conceptos, error: e1 }, { data: socios, error: e2 }] = await Promise.all([
      tabla(supabase, "caja_conceptos").select("*"),
      tabla(supabase, "caja_socios").select("*"),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const ordenar = (
      a: { orden?: number; nombre: string },
      b: { orden?: number; nombre: string },
    ) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre, "es");

    return {
      conceptos: ((conceptos ?? []) as ConceptoCaja[]).slice().sort(ordenar),
      socios: ((socios ?? []) as SocioCaja[]).slice().sort(ordenar),
    };
  });

/** Los apuntes de un rango de fechas, del más reciente al más antiguo. */
export const listarMovimientosCaja = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ desde: z.string(), hasta: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "caja_movimientos")
      .select("*")
      .gte("fecha", data.desde)
      .lte("fecha", data.hasta)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { movimientos: (filas ?? []) as MovimientoCaja[] };
  });

const apunteSchema = z.object({
  fecha: z.string().min(1, "La fecha es obligatoria"),
  concepto_id: z.string().uuid("Elige un concepto"),
  cliente_id: z.string().uuid().nullable().optional(),
  cliente_nombre: z.string().nullable().optional(),
  socio_id: z.string().uuid().nullable().optional(),
  importe: z.number().positive("El importe tiene que ser mayor que cero"),
  observaciones: z.string().nullable().optional(),
});

export const guardarMovimientoCaja = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => apunteSchema.extend({ id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const empresa_id = await empresaActiva(supabaseAdmin);

    const fila = {
      empresa_id,
      fecha: data.fecha,
      // La base la sobrescribe con la del concepto. Va aquí porque la columna
      // es NOT NULL, no porque este valor signifique nada.
      categoria: "ingreso",
      concepto_id: data.concepto_id,
      concepto_nombre: "",
      cliente_id: data.cliente_id ?? null,
      cliente_nombre: data.cliente_nombre?.trim() || null,
      socio_id: data.socio_id ?? null,
      importe: data.importe,
      observaciones: data.observaciones?.trim() || null,
    };

    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "caja_movimientos")
        .update(fila)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: creado, error } = await tabla(supabaseAdmin, "caja_movimientos")
      .insert(fila)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: creado.id as string };
  });

export const borrarMovimientoCaja = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { error } = await tabla(supabaseAdmin, "caja_movimientos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Alta y edición de conceptos.
 *
 * No hay borrado: un concepto en uso no se puede borrar —la base lo impide con
 * ON DELETE RESTRICT— y uno sin usar tampoco hace falta borrarlo si se puede
 * desactivar. Desactivar lo quita del desplegable y deja intactos los apuntes
 * que lo usaron.
 */
export const guardarConceptoCaja = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        nombre: z.string().trim().min(1, "El concepto necesita un nombre"),
        categoria: z.enum(["ingreso", "gasto"]),
        activo: z.boolean().optional(),
        orden: z.number().int().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const empresa_id = await empresaActiva(supabaseAdmin);

    const fila: Record<string, unknown> = {
      nombre: data.nombre.trim(),
      categoria: data.categoria,
    };
    if (data.activo !== undefined) fila.activo = data.activo;
    if (data.orden !== undefined) fila.orden = data.orden;

    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "caja_conceptos").update(fila).eq("id", data.id);
      if (error) throw new Error(mensajeDuplicado(error.message, "concepto"));
      return { id: data.id };
    }

    const { data: creado, error } = await tabla(supabaseAdmin, "caja_conceptos")
      .insert({ ...fila, empresa_id })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDuplicado(error.message, "concepto"));
    return { id: creado.id as string };
  });

export const guardarSocioCaja = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        nombre: z.string().trim().min(1, "El socio necesita un nombre"),
        activo: z.boolean().optional(),
        orden: z.number().int().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const empresa_id = await empresaActiva(supabaseAdmin);

    const fila: Record<string, unknown> = { nombre: data.nombre.trim() };
    if (data.activo !== undefined) fila.activo = data.activo;
    if (data.orden !== undefined) fila.orden = data.orden;

    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "caja_socios").update(fila).eq("id", data.id);
      if (error) throw new Error(mensajeDuplicado(error.message, "socio"));
      return { id: data.id };
    }

    const { data: creado, error } = await tabla(supabaseAdmin, "caja_socios")
      .insert({ ...fila, empresa_id })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDuplicado(error.message, "socio"));
    return { id: creado.id as string };
  });

/** «duplicate key value violates unique constraint» no le dice nada a nadie. */
function mensajeDuplicado(mensaje: string, que: string): string {
  if (/duplicate key|unique/i.test(mensaje)) return `Ya existe un ${que} con ese nombre`;
  return mensaje;
}
