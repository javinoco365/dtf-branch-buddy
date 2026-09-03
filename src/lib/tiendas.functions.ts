import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";

export type ResumenBorradoTienda = {
  nombre: string | null;
  facturas_emitidas: number;
  facturas_borrador: number;
  pedidos: number;
  clientes: number;
  productos: number;
  proyectos: number;
};

/**
 * Qué se llevaría por delante borrar una tienda.
 *
 * Se pide ANTES de enseñar el aviso, para que diga «143 pedidos y 87 clientes»
 * en vez de «¿seguro?». Y para poder decir que no se puede cuando hay facturas
 * emitidas, en lugar de dejar que el usuario lo intente y se coma el error.
 */
export const resumenBorradoTienda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const r = await llamarRpc<ResumenBorradoTienda>(context.supabase, "tienda_resumen_borrado", {
      _tienda_id: data.id,
    });
    return r;
  });

/**
 * Borra una tienda con todo lo que cuelga de ella.
 *
 * El freno de verdad está en el trigger `tienda_borrado_permitido`: una tienda
 * con facturas emitidas no se borra, porque `facturas.tienda_id` es ON DELETE
 * SET NULL y el documento quedaría sin saber de qué web salió. Aquí se
 * comprueba antes solo para dar un mensaje que se entienda.
 */
export const eliminarTienda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const resumen = await llamarRpc<ResumenBorradoTienda>(
      context.supabase,
      "tienda_resumen_borrado",
      { _tienda_id: data.id },
    );
    if (!resumen?.nombre) throw new Error("La tienda no existe");
    if (Number(resumen.facturas_emitidas) > 0) {
      throw new Error(
        `«${resumen.nombre}» tiene ${resumen.facturas_emitidas} factura(s) emitida(s) ` +
          "y no se puede borrar: las facturas se quedarían sin saber de qué tienda " +
          "salieron. Desactívala en su lugar.",
      );
    }

    const { error } = await context.supabase.from("tiendas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, nombre: resumen.nombre };
  });

/** Desactivar es la salida de las tiendas que no se pueden borrar. */
export const activarTienda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), activa: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "tiendas")
      .update({ activa: data.activa, sync_enabled: data.activa ? undefined : false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const tiendaSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1, "El nombre es obligatorio"),
  slug: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  woo_url: z.string().optional().nullable(),
  sync_enabled: z.boolean().optional(),
});

/** Editar la identidad de una tienda. Los datos fiscales son de la sociedad. */
export const actualizarTienda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tiendaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...resto } = data;
    const { error } = await context.supabase.from("tiendas").update(resto).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
