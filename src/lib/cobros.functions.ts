import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";
import { redondear } from "@/dominio/importes";
import type { MetodoCobro } from "@/dominio/cobros";

/**
 * Cobros de los pedidos, de las tiendas y del textil: una sola tabla y las
 * mismas dos operaciones. Ver 20260929100000_cobros.sql.
 */
export type Cobro = {
  id: string;
  pedido_id: string | null;
  textil_pedido_id: string | null;
  fecha: string;
  /** Lo aplicado al pedido, sin la propina. */
  importe: number;
  propina: number;
  metodo: MetodoCobro;
  caja_movimiento_id: string | null;
  previo: boolean;
  automatico: boolean;
  notas: string | null;
  created_at: string;
};

/**
 * El pedido tiene que ser visible para quien cobra. Se lee con su propia
 * sesión, así que es la RLS la que decide; solo después se usa la clave de
 * servicio, que es la única que puede llamar a las funciones de cobro.
 */
async function comprobarAcceso(supabase: unknown, tablaPedido: string, pedidoId: string) {
  const { data } = await tabla(supabase, tablaPedido).select("id").eq("id", pedidoId).maybeSingle();
  if (!data) throw new Error("Sin acceso a este pedido");
}

/**
 * Registra un cobro de un pedido de tienda o de uno textil. `importe` es lo
 * recibido: si supera lo pendiente, la base exige `es_propina` y separa el
 * exceso. En efectivo, crea en la misma transacción el apunte de ingreso en
 * Caja; con tarjeta o transferencia, cuenta en la Facturación Consolidada.
 */
export const registrarCobro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        pedido_id: z.string().uuid().nullable().optional(),
        textil_pedido_id: z.string().uuid().nullable().optional(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
        importe: z.number().positive("El importe tiene que ser mayor que cero"),
        metodo: z.enum(["efectivo", "tarjeta", "transferencia"]),
        es_propina: z.boolean().default(false),
        concepto_caja_id: z.string().uuid().nullable().optional(),
        notas: z.string().nullable().optional(),
      })
      .refine((c) => !!c.pedido_id !== !!c.textil_pedido_id, {
        message: "Un cobro es de un pedido de tienda o de uno textil",
      })
      .refine((c) => c.metodo !== "efectivo" || !!c.concepto_caja_id, {
        message: "Elige el concepto de caja del cobro en efectivo",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.pedido_id) await comprobarAcceso(context.supabase, "pedidos", data.pedido_id);
    else await comprobarAcceso(context.supabase, "textil_pedidos", data.textil_pedido_id!);

    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const id = await llamarRpc<string>(supabaseAdmin, "registrar_cobro", {
      _pedido_id: data.pedido_id ?? null,
      _textil_pedido_id: data.textil_pedido_id ?? null,
      _fecha: data.fecha,
      _recibido: redondear(data.importe),
      _metodo: data.metodo,
      _es_propina: data.es_propina,
      _concepto_caja_id: data.metodo === "efectivo" ? data.concepto_caja_id : null,
      _notas: data.notas ?? null,
    });
    return { id };
  });

/** Borra un cobro y, si fue en efectivo, su apunte de caja. El web, no. */
export const borrarCobro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cobro } = await tabla(context.supabase, "cobros")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (!cobro) throw new Error("Sin acceso a este cobro");
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    await llamarRpc<null>(supabaseAdmin, "borrar_cobro", { _cobro_id: data.id });
    return { ok: true };
  });
