import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcularLinea, calcularTotales as calcularTotalesDominio } from "@/dominio/importes";

// types.ts está generado y todavía no conoce las funciones del motor de
// facturación. El casting vive aquí, en un solo sitio, hasta que se regenere
// después de aplicar las migraciones.
async function llamarRpcTextil<T>(
  cliente: unknown,
  funcion: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const rpc = (
    cliente as {
      rpc: (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: T; error: { message: string } | null }>;
    }
  ).rpc;
  const { data, error } = await rpc.call(cliente, funcion, argumentos);
  if (error) throw new Error(error.message);
  return data;
}

// ============ MARCAS ============
export const listMarcas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("textil_marcas")
      .select("*")
      .order("nombre");
    if (error) throw error;
    return data ?? [];
  });

const marcaSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().min(1),
  logo_url: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  activa: z.boolean().optional(),
});

export const upsertMarca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => marcaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { data: row, error } = await context.supabase
        .from("textil_marcas")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("textil_marcas")
      .insert(rest)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const deleteMarca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("textil_marcas").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const setMarcaPredeterminada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ marca_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("empresa_global")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await context.supabase
        .from("empresa_global")
        .update({ textil_marca_predeterminada_id: data.marca_id })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("empresa_global")
        .insert({ textil_marca_predeterminada_id: data.marca_id, nombre_fiscal: "Empresa" } as any);
      if (error) throw error;
    }
    return { ok: true };
  });

// ============ STOCK ============
export const listStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("textil_stock").select("*").order("nombre");
    if (error) throw error;
    return data ?? [];
  });

const stockSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().optional().nullable(),
  nombre: z.string().min(1),
  categoria: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  talla: z.string().optional().nullable(),
  cantidad: z.number(),
  cantidad_minima: z.number(),
  coste_unitario: z.number(),
  precio_venta: z.number(),
  notas: z.string().optional().nullable(),
});

export const upsertStockItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => stockSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { data: row, error } = await context.supabase
        .from("textil_stock")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("textil_stock")
      .insert(rest)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const deleteStockItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("textil_stock").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============ CLIENTES ============
export const listTextilClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("textil_clientes")
      .select("*")
      .order("nombre");
    if (error) throw error;
    return data ?? [];
  });

const clienteSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().min(1),
  email: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  nif: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const upsertTextilCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clienteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { data: row, error } = await context.supabase
        .from("textil_clientes")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("textil_clientes")
      .insert(rest)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const deleteTextilCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("textil_clientes").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============ PRESUPUESTOS ============
export const listPresupuestos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("textil_presupuestos")
      .select("*, items:textil_presupuesto_items(*), marca:textil_marcas(id,nombre,color)")
      .order("fecha", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const itemSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number(),
  precio_unitario: z.number(),
  iva_pct: z.number(),
  stock_id: z.string().uuid().optional().nullable(),
});

const presupuestoSchema = z.object({
  id: z.string().uuid().optional(),
  cliente_id: z.string().uuid().optional().nullable(),
  cliente_nombre: z.string().optional().nullable(),
  cliente_email: z.string().optional().nullable(),
  cliente_nif: z.string().optional().nullable(),
  cliente_direccion: z.string().optional().nullable(),
  marca_id: z.string().uuid().optional().nullable(),
  fecha: z.string(),
  validez_dias: z.number(),
  estado: z.enum(["borrador", "enviado", "aceptado", "rechazado", "facturado"]).optional(),
  notas: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

// Delega en src/dominio/importes.ts: es el único cálculo válido del proyecto.
// Antes esta función no redondeaba en ningún momento, así que los importes que
// acababan en textil_facturas arrastraban el ruido de la coma flotante (un
// 12.087900000000001 dentro de un documento fiscal).
function calcularTotales(items: z.infer<typeof itemSchema>[]) {
  const totales = calcularTotalesDominio(items.map((it) => ({ ...it, iva_rate: it.iva_pct })));
  const itemsCalc = items.map((it) => ({
    ...it,
    subtotal: calcularLinea({ ...it, iva_rate: it.iva_pct }).base,
  }));
  return {
    itemsCalc,
    subtotal: totales.base_imponible,
    iva: totales.iva_total,
    total: totales.total,
  };
}

// Suma cantidades por stock_id
function agruparStock(items: { stock_id?: string | null; cantidad: number }[]) {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!it.stock_id) continue;
    map.set(it.stock_id, (map.get(it.stock_id) ?? 0) + Number(it.cantidad));
  }
  return map;
}

async function validarDisponibilidad(
  supabase: any,
  nuevos: Map<string, number>,
  previos: Map<string, number> = new Map(),
) {
  if (nuevos.size === 0) return;
  const ids = Array.from(nuevos.keys());
  const { data, error } = await supabase
    .from("textil_stock")
    .select("id, nombre, cantidad")
    .in("id", ids);
  if (error) throw error;
  const faltantes: string[] = [];
  for (const s of data ?? []) {
    const pedido = nuevos.get(s.id) ?? 0;
    const yaReservado = previos.get(s.id) ?? 0;
    const disponible = Number(s.cantidad) + yaReservado;
    if (pedido > disponible) {
      faltantes.push(`${s.nombre}: solicitado ${pedido}, disponible ${disponible}`);
    }
  }
  if (faltantes.length) {
    throw new Error(`Stock insuficiente — ${faltantes.join("; ")}`);
  }
}

async function ajustarStock(
  supabase: any,
  delta: Map<string, number>, // positivo = descontar, negativo = devolver
) {
  for (const [id, cant] of delta.entries()) {
    if (!cant) continue;
    const { data, error } = await supabase
      .from("textil_stock")
      .select("cantidad")
      .eq("id", id)
      .single();
    if (error) throw error;
    const nueva = Number(data.cantidad) - cant;
    const { error: uErr } = await supabase
      .from("textil_stock")
      .update({ cantidad: nueva })
      .eq("id", id);
    if (uErr) throw uErr;
  }
}

// Numeración de presupuestos y pedidos. NO SIRVE PARA FACTURAS y no debe
// volver a usarse para ellas: lee el último número y le suma uno, así que dos
// usuarios a la vez obtienen el mismo, y al ordenar por created_at sin filtrar
// por ejercicio la secuencia se reinicia mal al cambiar de año. Las facturas van
// por emitir_factura_textil(), que asigna el número con la fila de la serie
// bloqueada.
//
// Un presupuesto repetido es una molestia; una factura repetida es un problema
// legal. Aun así, conviene darle el mismo trato: anotado, sin arreglar aquí.
async function nextNumero(supabase: any, table: string, prefix: string) {
  const { data } = await supabase
    .from(table)
    .select("numero")
    .like("numero", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = data?.[0]?.numero as string | undefined;
  const year = new Date().getFullYear();
  const seqPart = last?.split("-").pop();
  const seq = seqPart ? parseInt(seqPart, 10) + 1 : 1;
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

export const upsertPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => presupuestoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { items, id, ...header } = data;
    const totals = calcularTotales(items);

    // Alerta (no reserva) de stock disponible al crear presupuestos
    await validarDisponibilidad(context.supabase, agruparStock(items));

    const payload = {
      ...header,
      subtotal: totals.subtotal,
      iva: totals.iva,
      total: totals.total,
    };

    let presupuestoId = id;
    if (id) {
      const { error } = await context.supabase
        .from("textil_presupuestos")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
      await context.supabase.from("textil_presupuesto_items").delete().eq("presupuesto_id", id);
    } else {
      const numero = await nextNumero(context.supabase, "textil_presupuestos", "PRES");
      const { data: row, error } = await context.supabase
        .from("textil_presupuestos")
        .insert({ ...payload, numero })
        .select("id")
        .single();
      if (error) throw error;
      presupuestoId = row.id;
    }

    const { error: itErr } = await context.supabase.from("textil_presupuesto_items").insert(
      totals.itemsCalc.map((it) => ({
        presupuesto_id: presupuestoId!,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        iva_pct: it.iva_pct,
        subtotal: it.subtotal,
        stock_id: it.stock_id ?? null,
      })),
    );
    if (itErr) throw itErr;
    return { id: presupuestoId };
  });

export const deletePresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("textil_presupuestos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const updatePresupuestoEstado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        estado: z.enum(["borrador", "enviado", "aceptado", "rechazado", "facturado"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("textil_presupuestos")
      .update({ estado: data.estado })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Convierte un presupuesto aceptado en factura.
 *
 * El número lo asigna emitir_factura_textil() en la base, con la fila de la
 * serie bloqueada. Antes lo calculaba nextNumero() leyendo el último número y
 * sumándole uno: dos usuarios a la vez obtenían el mismo, y al cambiar de
 * ejercicio la secuencia se reiniciaba mal.
 */
export const convertirPresupuestoEnFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pres, error } = await context.supabase
      .from("textil_presupuestos")
      .select("*, items:textil_presupuesto_items(*)")
      .eq("id", data.id)
      .single();
    if (error) throw error;
    if (pres.factura_id) throw new Error("Este presupuesto ya está facturado");
    if (!pres.items?.length) throw new Error("El presupuesto no tiene líneas");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const factura = await llamarRpcTextil<{ id: string; numero: string; total: number }>(
      supabaseAdmin,
      "emitir_factura_textil",
      {
        _usuario_id: context.userId,
        _receptor: {
          nombre: pres.cliente_nombre,
          email: pres.cliente_email,
          nif: pres.cliente_nif,
          direccion: pres.cliente_direccion,
        },
        _lineas: pres.items.map((it: any) => ({
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          unidad: "ud",
          precio_unitario: Number(it.precio_unitario),
          iva_rate: Number(it.iva_pct),
        })),
        _marca_id: pres.marca_id,
        _cliente_id: pres.cliente_id,
        _presupuesto_id: pres.id,
        _notas: pres.notas,
      },
    );

    await context.supabase
      .from("textil_presupuestos")
      .update({ estado: "facturado", factura_id: factura.id })
      .eq("id", pres.id);

    return { facturaId: factura.id, numero: factura.numero };
  });

// ============ FACTURAS ============
export const listTextilFacturas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("textil_facturas")
      .select("*, items:textil_factura_items(*), marca:textil_marcas(id,nombre,color)")
      .order("fecha", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

/**
 * Borra una factura textil.
 *
 * Solo funciona con borradores. Antes borraba cualquier factura sin mirar el
 * estado, y sus líneas caían en cascada: era un botón de papelera que destruía
 * documentos fiscales. La base lo impide ahora por trigger; esto lo dice antes
 * y con un mensaje que se entiende.
 */
export const deleteTextilFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: factura } = await context.supabase
      .from("textil_facturas")
      .select("estado, numero")
      .eq("id", data.id)
      .maybeSingle();

    if (!factura) throw new Error("La factura no existe");
    if (factura.estado !== "borrador") {
      throw new Error(
        `La factura ${factura.numero} está emitida y no se borra. Emite una rectificativa.`,
      );
    }

    const { error } = await context.supabase.from("textil_facturas").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============ PEDIDOS ============
export const listTextilPedidos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("textil_pedidos")
      .select("*, items:textil_pedido_items(*), marca:textil_marcas(id,nombre,color)")
      .order("fecha", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const pedidoSchema = z.object({
  id: z.string().uuid().optional(),
  cliente_id: z.string().uuid().optional().nullable(),
  cliente_nombre: z.string().optional().nullable(),
  cliente_email: z.string().optional().nullable(),
  marca_id: z.string().uuid().optional().nullable(),
  fecha: z.string(),
  estado: z.string(),
  metodo_pago: z.string().optional().nullable(),
  envio: z.number(),
  notas: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

export const upsertTextilPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pedidoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { items, id, ...header } = data;
    const totals = calcularTotales(items);

    // Cantidades ya reservadas previamente (para no doblar contabilidad al editar)
    let previos = new Map<string, number>();
    if (id) {
      const { data: prevItems } = await context.supabase
        .from("textil_pedido_items")
        .select("stock_id, cantidad")
        .eq("pedido_id", id);
      previos = agruparStock((prevItems ?? []) as any);
    }
    const nuevos = agruparStock(items);
    await validarDisponibilidad(context.supabase, nuevos, previos);

    const payload = {
      ...header,
      subtotal: totals.subtotal,
      iva: totals.iva,
      total: totals.total + (header.envio ?? 0),
    };
    let pedidoId = id;
    if (id) {
      const { error } = await context.supabase.from("textil_pedidos").update(payload).eq("id", id);
      if (error) throw error;
      await context.supabase.from("textil_pedido_items").delete().eq("pedido_id", id);
    } else {
      const numero = await nextNumero(context.supabase, "textil_pedidos", "TPD");
      const { data: row, error } = await context.supabase
        .from("textil_pedidos")
        .insert({ ...payload, numero })
        .select("id")
        .single();
      if (error) throw error;
      pedidoId = row.id;
    }
    const { error: itErr } = await context.supabase.from("textil_pedido_items").insert(
      totals.itemsCalc.map((it) => ({
        pedido_id: pedidoId!,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        iva_pct: it.iva_pct,
        subtotal: it.subtotal,
        stock_id: it.stock_id ?? null,
      })),
    );
    if (itErr) throw itErr;

    // Reservar stock: descontar la diferencia (nuevo - previo) por cada stock_id
    const delta = new Map<string, number>();
    const keys = new Set([...nuevos.keys(), ...previos.keys()]);
    for (const k of keys) {
      const d = (nuevos.get(k) ?? 0) - (previos.get(k) ?? 0);
      if (d !== 0) delta.set(k, d);
    }
    await ajustarStock(context.supabase, delta);

    return { id: pedidoId };
  });

export const updateTextilPedidoEstado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), estado: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    // Si se cancela un pedido, devolver el stock reservado
    if (data.estado === "cancelado") {
      const { data: prev } = await context.supabase
        .from("textil_pedidos")
        .select("estado")
        .eq("id", data.id)
        .single();
      if (prev && prev.estado !== "cancelado") {
        const { data: prevItems } = await context.supabase
          .from("textil_pedido_items")
          .select("stock_id, cantidad")
          .eq("pedido_id", data.id);
        const restore = agruparStock((prevItems ?? []) as any);
        const delta = new Map<string, number>();
        for (const [k, v] of restore.entries()) delta.set(k, -v);
        await ajustarStock(context.supabase, delta);
      }
    }
    const { error } = await context.supabase
      .from("textil_pedidos")
      .update({ estado: data.estado })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteTextilPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Devolver stock reservado antes de borrar (si no estaba cancelado)
    const { data: ped } = await context.supabase
      .from("textil_pedidos")
      .select("estado")
      .eq("id", data.id)
      .single();
    if (ped && ped.estado !== "cancelado") {
      const { data: prevItems } = await context.supabase
        .from("textil_pedido_items")
        .select("stock_id, cantidad")
        .eq("pedido_id", data.id);
      const restore = agruparStock((prevItems ?? []) as any);
      const delta = new Map<string, number>();
      for (const [k, v] of restore.entries()) delta.set(k, -v);
      await ajustarStock(context.supabase, delta);
    }
    const { error } = await context.supabase.from("textil_pedidos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============ EMPRESA ============
export const getEmpresaGlobal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("empresa_global")
      .select("*")
      .limit(1)
      .maybeSingle();
    return data;
  });
