import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaTabla, llamarRpc, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import {
  ambitoPresupuesto,
  prefijoDeTienda,
  referenciaPresupuesto,
  totalesPresupuesto,
  type EstadoPresupuesto,
} from "@/dominio/presupuestos";

/**
 * Presupuestos de las tiendas. Ver 20261001100000_presupuestos_tiendas.sql.
 *
 * Todo va con la sesión de quien los usa: la RLS decide qué tiendas puede ver
 * y tocar. El número lo da siguiente_numero(), con la fila del contador
 * bloqueada: dos presupuestos a la vez no se llevan el mismo.
 */

export type LineaPresupuestoGuardada = {
  id: string;
  producto_id: string | null;
  orden: number;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  subtotal: number;
  iva: number;
  total: number;
};

export type Presupuesto = {
  id: string;
  empresa_id: string;
  tienda_id: string;
  numero: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_email: string | null;
  cliente_telefono: string | null;
  fecha: string;
  validez_dias: number;
  estado: EstadoPresupuesto;
  subtotal: number;
  iva: number;
  envio: number;
  total: number;
  notas: string | null;
  pedido_id: string | null;
  /** El pedido que salió al confirmarlo, si salió. */
  pedido: { numero: string } | null;
  created_at: string;
  items: LineaPresupuestoGuardada[];
};

const ESTADOS = ["borrador", "enviado", "aceptado", "rechazado"] as const;

export const listPresupuestosTienda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tiendaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const { data: filas, error } = await leerTodas<Presupuesto>((a, b) =>
      tabla(context.supabase, "presupuestos")
        .select("*, items:presupuesto_items(*), pedido:pedidos(numero)")
        .eq("tienda_id", data.tiendaId)
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (faltaLaTabla(error)) return { disponible: false, presupuestos: [] as Presupuesto[] };
    if (error) throw new Error(error.message);
    const presupuestos = filas.map((p) => ({
      ...p,
      items: [...(p.items ?? [])].sort((a, b) => a.orden - b.orden),
    }));
    return { disponible: true, presupuestos };
  });

const lineaSchema = z.object({
  producto_id: z.string().uuid().nullable().optional(),
  descripcion: z.string().trim().min(1, "Cada línea necesita una descripción"),
  cantidad: z.number().positive("La cantidad tiene que ser mayor que cero"),
  unidad: z.string().trim().min(1).max(8),
  precio_unitario: z.number().nonnegative("El precio no puede ser negativo"),
  iva_rate: z.number().min(0).max(100),
});

export const guardarPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tienda_id: z.string().uuid(),
        cliente_id: z.string().uuid().nullable().optional(),
        cliente_nombre: z.string().trim().min(1, "Elige o escribe el cliente"),
        cliente_email: z.string().trim().nullable().optional(),
        cliente_telefono: z.string().trim().nullable().optional(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
        validez_dias: z.number().int().positive("La validez tiene que ser de al menos un día"),
        envio: z.number().nonnegative().default(0),
        notas: z.string().nullable().optional(),
        lineas: z.array(lineaSchema).min(1, "El presupuesto necesita al menos una línea"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const t = totalesPresupuesto(
      data.lineas.map((l) => ({ ...l, producto_id: l.producto_id ?? null })),
      data.envio,
    );

    const cabecera = {
      cliente_id: data.cliente_id ?? null,
      cliente_nombre: data.cliente_nombre,
      cliente_email: data.cliente_email || null,
      cliente_telefono: data.cliente_telefono || null,
      fecha: data.fecha,
      validez_dias: data.validez_dias,
      envio: t.envio,
      subtotal: t.subtotal,
      iva: t.iva,
      total: t.total,
      notas: data.notas?.trim() || null,
    };

    let presupuestoId = data.id;
    if (data.id) {
      const { data: actual } = await tabla(sb, "presupuestos")
        .select("id, tienda_id, pedido_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!actual || actual.tienda_id !== data.tienda_id) {
        throw new Error("Sin acceso a este presupuesto");
      }
      if (actual.pedido_id) {
        throw new Error("Este presupuesto ya es un pedido: no se puede cambiar.");
      }
      const { error } = await tabla(sb, "presupuestos").update(cabecera).eq("id", data.id);
      if (error) throw new Error(error.message);
      const { error: errBorrar } = await tabla(sb, "presupuesto_items")
        .delete()
        .eq("presupuesto_id", data.id);
      if (errBorrar) throw new Error(errBorrar.message);
    } else {
      // La tienda con la sesión de quien crea: si no es suya, no la ve.
      const { data: tienda } = await tabla(sb, "tiendas")
        .select("id, empresa_id, prefijo, slug, nombre")
        .eq("id", data.tienda_id)
        .maybeSingle();
      if (!tienda) throw new Error("Sin acceso a esta tienda");

      const ejercicio = Number(data.fecha.slice(0, 4));
      const n = await llamarRpc<number>(sb, "siguiente_numero", {
        _empresa_id: tienda.empresa_id,
        _ambito: ambitoPresupuesto(tienda.id),
        _ejercicio: ejercicio,
      });
      const { data: creado, error } = await tabla(sb, "presupuestos")
        .insert({
          ...cabecera,
          empresa_id: tienda.empresa_id,
          tienda_id: tienda.id,
          numero: referenciaPresupuesto(prefijoDeTienda(tienda), ejercicio, n),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      presupuestoId = creado.id as string;
    }

    const { error: errLineas } = await tabla(sb, "presupuesto_items").insert(
      t.lineas.map((l, i) => ({
        presupuesto_id: presupuestoId,
        producto_id: l.producto_id ?? null,
        orden: i,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        unidad: l.unidad,
        precio_unitario: l.precio_unitario,
        iva_rate: l.iva_rate,
        subtotal: l.subtotal,
        iva: l.iva,
        total: l.total,
      })),
    );
    if (errLineas) throw new Error(errLineas.message);
    return { id: presupuestoId! };
  });

export const cambiarEstadoPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), estado: z.enum(ESTADOS) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "presupuestos")
      .update({ estado: data.estado })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!filas?.length) throw new Error("Sin acceso a este presupuesto");
    return { ok: true };
  });

export const borrarPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: actual } = await tabla(context.supabase, "presupuestos")
      .select("id, pedido_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!actual) throw new Error("Sin acceso a este presupuesto");
    if (actual.pedido_id) {
      throw new Error("Este presupuesto ya es un pedido: bórralo desde el pedido si hace falta.");
    }
    const { error } = await tabla(context.supabase, "presupuestos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Confirma un presupuesto: crea su pedido con las mismas líneas e importes, y
 * lo deja aceptado. Lo hace confirmar_presupuesto() en la base, en una sola
 * transacción y con el presupuesto bloqueado: dos clics no crean dos pedidos.
 */
export const confirmarPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const pedidoId = await llamarRpc<string>(context.supabase, "confirmar_presupuesto", {
      _presupuesto_id: data.id,
    });
    const { data: pedido } = await tabla(context.supabase, "pedidos")
      .select("id, numero")
      .eq("id", pedidoId)
      .maybeSingle();
    return { id: pedidoId, numero: (pedido?.numero as string | undefined) ?? null };
  });
