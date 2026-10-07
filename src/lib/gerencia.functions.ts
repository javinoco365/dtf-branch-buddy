import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import { TIPOS_GASTO } from "@/dominio/impuestos";
import {
  AJUSTES_POR_DEFECTO,
  type AjustesGerencia,
  type GastoFijo,
  type Objetivo,
} from "@/dominio/gerencia";

/**
 * Ajustes de Gerencia: gastos fijos, objetivos y si los pedidos web sin
 * pagar cuentan como vendidos.
 *
 * Se leen con la RLS del usuario. Se escriben con el cliente de servicio
 * diciendo quién es (adminComoUsuario), para que la auditoría tenga autor,
 * igual que la caja. Las reglas (importes positivos, fechas en orden, un
 * objetivo por mes y el día 1) las impone la base.
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

/** Los errores de la base, en castellano y sin jerga. */
function errorLegible(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("Ya hay un objetivo para ese mes. Edítalo.");
  if (error.code === "23514") {
    if (error.message.includes("fechas"))
      return new Error("La fecha de fin es anterior a la de inicio.");
    if (error.message.includes("primer_dia"))
      return new Error("Un objetivo empieza el día 1 del mes.");
    if (error.message.includes("algo")) return new Error("Pon al menos los metros o las ventas.");
    return new Error("Los importes tienen que ser mayores que cero.");
  }
  return new Error(error.message);
}

export type DatosAjustesGerencia = {
  /** Falso si la migración 20261008100000_gerencia_ajustes no está aplicada. */
  disponible: boolean;
  /** Falso si la migración 20261010100000_gastos_impuestos no está aplicada. */
  impuestosDisponibles: boolean;
  ajustes: AjustesGerencia;
  gastos: GastoFijo[];
  objetivos: Objetivo[];
};

export const leerAjustesGerencia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DatosAjustesGerencia> => {
    // Sin la migración de impuestos (20261010100000) las columnas nuevas no
    // existen: se leen las de antes y valen los valores por defecto.
    const leerAjustes = (nuevas: boolean) =>
      tabla(context.supabase, "gerencia_ajustes")
        .select(`web_sin_pagar_cuenta${nuevas ? ", tipo_is, cuota_is_anterior, precio_metro" : ""}`)
        .limit(1);
    const leerGastos = (nuevas: boolean) =>
      tabla(context.supabase, "gerencia_gastos_fijos")
        .select(
          `id, concepto, importe_mensual, desde, hasta, notas${nuevas ? ", periodicidad, tipo, iva_pct, irpf_pct" : ""}`,
        )
        .order("desde", { ascending: false });
    const [a0, g0, o] = await Promise.all([
      leerAjustes(true),
      leerGastos(true),
      tabla(context.supabase, "gerencia_objetivos")
        .select("id, desde, metros, vendido")
        .order("desde", { ascending: false }),
    ]);
    const conImpuestos = !faltaLaColumna(a0.error) && !faltaLaColumna(g0.error);
    const a = faltaLaColumna(a0.error) ? await leerAjustes(false) : a0;
    const g = faltaLaColumna(g0.error) ? await leerGastos(false) : g0;
    if (faltaLaTabla(a.error) || faltaLaTabla(g.error) || faltaLaTabla(o.error)) {
      return {
        disponible: false,
        impuestosDisponibles: false,
        ajustes: AJUSTES_POR_DEFECTO,
        gastos: [],
        objetivos: [],
      };
    }
    const error = a.error ?? g.error ?? o.error;
    if (error) throw new Error(error.message);
    const fila = (a.data ?? [])[0] as Partial<Record<keyof AjustesGerencia, unknown>> | undefined;
    return {
      disponible: true,
      impuestosDisponibles: conImpuestos,
      ajustes: {
        web_sin_pagar_cuenta:
          typeof fila?.web_sin_pagar_cuenta === "boolean"
            ? fila.web_sin_pagar_cuenta
            : AJUSTES_POR_DEFECTO.web_sin_pagar_cuenta,
        tipo_is: fila?.tipo_is != null ? Number(fila.tipo_is) : AJUSTES_POR_DEFECTO.tipo_is,
        cuota_is_anterior: fila?.cuota_is_anterior != null ? Number(fila.cuota_is_anterior) : null,
        precio_metro:
          fila?.precio_metro != null ? Number(fila.precio_metro) : AJUSTES_POR_DEFECTO.precio_metro,
      },
      gastos: (g.data ?? []) as GastoFijo[],
      objetivos: (o.data ?? []) as Objetivo[],
    };
  });

export const guardarAjustesGerencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        web_sin_pagar_cuenta: z.boolean().optional(),
        tipo_is: z.number().min(0).max(100).optional(),
        cuota_is_anterior: z.number().min(0).nullable().optional(),
        precio_metro: z.number().positive("El metro tiene que valer más de 0").optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const empresa_id = await empresaActiva(supabaseAdmin);
    // Solo lo que llega: cambiar un ajuste no toca los demás.
    const cambios = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const { error } = await tabla(supabaseAdmin, "gerencia_ajustes").upsert(
      { empresa_id, ...cambios },
      { onConflict: "empresa_id" },
    );
    if (error) throw errorLegible(error);
    return { ok: true };
  });

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");

export const guardarGastoFijo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        concepto: z.string().trim().min(1, "Pon un concepto"),
        importe_mensual: z.number().positive("El importe tiene que ser mayor que cero"),
        desde: dia,
        hasta: dia.nullable(),
        notas: z.string().nullable().optional(),
        periodicidad: z.enum(["mensual", "trimestral", "anual", "puntual"]).optional(),
        tipo: z.enum(TIPOS_GASTO.map((t) => t.valor) as [string, ...string[]]).optional(),
        iva_pct: z.number().min(0).max(100).optional(),
        irpf_pct: z.number().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const fila = {
      concepto: data.concepto,
      importe_mensual: data.importe_mensual,
      desde: data.desde,
      hasta: data.hasta,
      notas: data.notas?.trim() || null,
      // Sin la migración de impuestos no se mandan: la base no las conoce.
      ...(data.periodicidad !== undefined
        ? {
            periodicidad: data.periodicidad,
            tipo: data.tipo ?? "otros",
            iva_pct: data.iva_pct ?? 0,
            irpf_pct: data.irpf_pct ?? 0,
          }
        : {}),
    };
    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "gerencia_gastos_fijos")
        .update(fila)
        .eq("id", data.id);
      if (error) throw errorLegible(error);
      return { id: data.id };
    }
    const empresa_id = await empresaActiva(supabaseAdmin);
    const { data: creado, error } = await tabla(supabaseAdmin, "gerencia_gastos_fijos")
      .insert({ ...fila, empresa_id })
      .select("id")
      .single();
    if (error) throw errorLegible(error);
    return { id: creado.id as string };
  });

export const borrarGastoFijo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { error } = await tabla(supabaseAdmin, "gerencia_gastos_fijos")
      .delete()
      .eq("id", data.id);
    if (error) throw errorLegible(error);
    return { ok: true };
  });

export const guardarObjetivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        desde: z.string().regex(/^\d{4}-\d{2}-01$/, "Un objetivo empieza el día 1 del mes"),
        metros: z.number().positive().nullable(),
        vendido: z.number().positive().nullable(),
      })
      .refine(
        (o) => o.metros !== null || o.vendido !== null,
        "Pon al menos los metros o las ventas",
      )
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const fila = { desde: data.desde, metros: data.metros, vendido: data.vendido };
    if (data.id) {
      const { error } = await tabla(supabaseAdmin, "gerencia_objetivos")
        .update(fila)
        .eq("id", data.id);
      if (error) throw errorLegible(error);
      return { id: data.id };
    }
    const empresa_id = await empresaActiva(supabaseAdmin);
    const { data: creado, error } = await tabla(supabaseAdmin, "gerencia_objetivos")
      .insert({ ...fila, empresa_id })
      .select("id")
      .single();
    if (error) throw errorLegible(error);
    return { id: creado.id as string };
  });

export const borrarObjetivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { error } = await tabla(supabaseAdmin, "gerencia_objetivos").delete().eq("id", data.id);
    if (error) throw errorLegible(error);
    return { ok: true };
  });
