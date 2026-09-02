import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function calcularTotales(items: z.infer<typeof itemSchema>[]) {
  let subtotal = 0;
  let iva = 0;
  const itemsCalc = items.map((it) => {
    const st = it.cantidad * it.precio_unitario;
    subtotal += st;
    iva += st * (it.iva_pct / 100);
    return { ...it, subtotal: st };
  });
  return { itemsCalc, subtotal, iva, total: subtotal + iva };
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

    const numero = await nextNumero(context.supabase, "textil_facturas", "FAC");
    const { data: fac, error: facErr } = await context.supabase
      .from("textil_facturas")
      .insert({
        numero,
        cliente_id: pres.cliente_id,
        cliente_nombre: pres.cliente_nombre,
        cliente_email: pres.cliente_email,
        cliente_nif: pres.cliente_nif,
        cliente_direccion: pres.cliente_direccion,
        marca_id: pres.marca_id,
        presupuesto_id: pres.id,
        fecha: new Date().toISOString().slice(0, 10),
        estado: "emitida",
        subtotal: pres.subtotal,
        iva: pres.iva,
        total: pres.total,
        notas: pres.notas,
      })
      .select("id")
      .single();
    if (facErr) throw facErr;

    const items = (pres.items ?? []).map((it: any) => ({
      factura_id: fac.id,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      iva_pct: it.iva_pct,
      subtotal: it.subtotal,
    }));
    if (items.length) {
      const { error: itErr } = await context.supabase.from("textil_factura_items").insert(items);
      if (itErr) throw itErr;
    }

    await context.supabase
      .from("textil_presupuestos")
      .update({ estado: "facturado", factura_id: fac.id })
      .eq("id", pres.id);

    return { facturaId: fac.id, numero };
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

export const deleteTextilFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
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
