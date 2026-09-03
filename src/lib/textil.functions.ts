import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";
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
    // La empresa existe siempre: la migración 20260903100000 se asegura de ello.
    // La rama que la creaba al vuelo insertaba una fila con nombre_fiscal
    // "Empresa", que es exactamente el dato inventado que acabaría impreso en
    // una factura.
    const { data: existing } = await tabla(context.supabase, "empresas")
      .select("id")
      .eq("activa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!existing) throw new Error("No hay ninguna empresa activa configurada");

    const { error } = await tabla(context.supabase, "empresas")
      .update({ textil_marca_predeterminada_id: data.marca_id })
      .eq("id", existing.id);
    if (error) throw error;
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
    const { id, cantidad, ...rest } = data;

    // La cantidad ya no se escribe aquí: es la suma del libro de movimientos y
    // hay un guardián en la base que lo impide. Al editar se ignora; al crear
    // se anota como existencias iniciales.
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
      .insert({ ...rest, cantidad: 0 })
      .select()
      .single();
    if (error) throw error;

    const inicial = Number(cantidad) || 0;
    if (inicial > 0) {
      const { error: mErr } = await tabla(context.supabase, "textil_stock_movimientos").insert({
        empresa_id: await empresaActiva(context.supabase),
        stock_id: row.id,
        motivo: "inicial",
        cantidad: inicial,
        coste_unitario: Number(rest.coste_unitario) || 0,
        nota: "Existencias al dar de alta la variante",
      });
      if (mErr) throw mErr;
    }
    return row;
  });

/**
 * Anota un movimiento de stock: una compra, una merma o un recuento.
 *
 * Es la única forma de que cambie una cantidad. La base lo exige.
 */
export const registrarMovimientoStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        stock_id: z.string().uuid(),
        motivo: z.enum([
          "compra",
          "merma",
          "ajuste_inventario",
          "devolucion_cliente",
          "devolucion_proveedor",
        ]),
        cantidad: z.number().refine((n) => n !== 0, "La cantidad no puede ser cero"),
        coste_unitario: z.number().nonnegative().default(0),
        nota: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "textil_stock_movimientos").insert({
      empresa_id: await empresaActiva(context.supabase),
      stock_id: data.stock_id,
      motivo: data.motivo,
      cantidad: data.cantidad,
      coste_unitario: data.coste_unitario,
      nota: data.nota ?? null,
    });
    if (error) throw error;
    return { ok: true };
  });

/** El libro de una variante: de dónde viene cada unidad que tiene o tuvo. */
export const listMovimientosStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ stock_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "textil_stock_movimientos")
      .select("id, motivo, cantidad, coste_unitario, nota, created_at")
      .eq("stock_id", data.stock_id)
      .order("id", { ascending: false })
      .limit(200);
    if (error) throw error;
    return filas ?? [];
  });

export const deleteStockItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Se borra si nunca se movió; si tiene historia, se desactiva. Sus
    // movimientos son la historia de coste de lo que ya vendiste.
    const resultado = await llamarRpc<string>(context.supabase, "textil_stock_retirar", {
      _stock_id: data.id,
    });
    return { ok: true, resultado };
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
function calcularTotales(items: z.infer<typeof itemSchema>[], envio = 0) {
  const totales = calcularTotalesDominio(
    items.map((it) => ({ ...it, iva_rate: it.iva_pct })),
    { envio },
  );
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

// Estados en los que la mercancía ya ha salido de la estantería. Hasta llegar
// aquí un pedido solo reserva; a partir de aquí hay un movimiento de stock.
const ESTADOS_SALIDA = new Set(["enviado", "entregado"]);

/**
 * Comprueba que hay stock DISPONIBLE, que no es lo mismo que stock físico.
 *
 * disponible = físico − reservado. Lo físico son las camisetas que hay en el
 * armario; lo reservado, las que ya están prometidas a otros pedidos sin
 * entregar. `previos` es lo que este mismo pedido tenía reservado antes de
 * editarlo: se devuelve al montón porque va a sustituirse, no a sumarse.
 */
async function validarDisponibilidad(
  supabase: any,
  nuevos: Map<string, number>,
  previos: Map<string, number> = new Map(),
) {
  if (nuevos.size === 0) return;
  const ids = Array.from(nuevos.keys());
  const { data, error } = await supabase
    .from("textil_stock")
    .select("id, nombre, cantidad, cantidad_reservada")
    .in("id", ids);
  if (error) throw error;
  const faltantes: string[] = [];
  for (const s of data ?? []) {
    const pedido = nuevos.get(s.id) ?? 0;
    const yaReservado = previos.get(s.id) ?? 0;
    const disponible = Number(s.cantidad) - Number(s.cantidad_reservada ?? 0) + yaReservado;
    if (pedido > disponible) {
      faltantes.push(`${s.nombre}: solicitado ${pedido}, disponible ${disponible}`);
    }
  }
  if (faltantes.length) {
    throw new Error(`Stock insuficiente — ${faltantes.join("; ")}`);
  }
}

/**
 * Mueve stock anotándolo en el libro.
 *
 * Antes esto leía la cantidad, restaba y escribía. Dos pedidos simultáneos
 * leían el mismo número y uno de los dos descuentos se perdía, sin que nada
 * avisara. Ahora cada movimiento es una fila y el saldo lo recalcula un trigger
 * con la fila de la variante bloqueada, así que no hay carrera posible.
 *
 * `delta` viene en la convención de antes: positivo descuenta, negativo
 * devuelve. En el libro se anota con el signo contrario, que es el natural.
 */
async function ajustarStock(
  supabase: any,
  delta: Map<string, number>,
  empresaId: string,
  pedidoId?: string | null,
) {
  const movimientos = [];
  for (const [id, cant] of delta.entries()) {
    if (!cant) continue;
    movimientos.push({
      empresa_id: empresaId,
      stock_id: id,
      motivo: cant > 0 ? "venta" : "devolucion_cliente",
      cantidad: -cant,
      textil_pedido_id: pedidoId ?? null,
    });
  }
  if (movimientos.length === 0) return;

  const { error } = await tabla(supabase, "textil_stock_movimientos").insert(movimientos);
  if (error) throw error;
}

/**
 * Deja las reservas del pedido valiendo exactamente `objetivo`.
 *
 * Una reserva no mueve stock: solo aparta lo comprometido para que la pantalla
 * no te deje prometérselo a otro cliente. Borra las variantes que ya no están
 * en el pedido y actualiza las que siguen, así que editar un pedido dos veces
 * no acumula reservas.
 */
async function sincronizarReservas(
  supabase: any,
  pedidoId: string,
  empresaId: string,
  objetivo: Map<string, number>,
) {
  const ids = Array.from(objetivo.keys());
  const borrado = tabla(supabase, "textil_stock_reservas")
    .delete()
    .eq("textil_pedido_id", pedidoId);
  const { error: errBorrado } = ids.length
    ? await borrado.not("stock_id", "in", `(${ids.join(",")})`)
    : await borrado;
  if (errBorrado) throw errBorrado;
  if (ids.length === 0) return;

  const { error } = await tabla(supabase, "textil_stock_reservas").upsert(
    ids.map((stock_id) => ({
      empresa_id: empresaId,
      stock_id,
      textil_pedido_id: pedidoId,
      cantidad: objetivo.get(stock_id)!,
    })),
    { onConflict: "textil_pedido_id,stock_id" },
  );
  if (error) throw error;
}

/** Lo que el pedido lleva hoy, agrupado por variante. */
async function itemsDelPedido(supabase: any, pedidoId: string) {
  const { data } = await supabase
    .from("textil_pedido_items")
    .select("stock_id, cantidad")
    .eq("pedido_id", pedidoId);
  return agruparStock((data ?? []) as any);
}

async function estadoDelPedido(supabase: any, pedidoId: string): Promise<string | null> {
  const { data } = await supabase
    .from("textil_pedidos")
    .select("estado")
    .eq("id", pedidoId)
    .maybeSingle();
  return (data?.estado as string | undefined) ?? null;
}

/** Le da la vuelta a un mapa de cantidades: lo que salió, vuelve. */
function negar(mapa: Map<string, number>) {
  const r = new Map<string, number>();
  for (const [k, v] of mapa.entries()) r.set(k, -v);
  return r;
}

/** La empresa activa. El libro de stock la necesita en cada movimiento. */
async function empresaActiva(supabase: any): Promise<string> {
  const { data } = await tabla(supabase, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data?.id) throw new Error("No hay ninguna empresa activa configurada");
  return data.id as string;
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
    // El envío dentro de la base imponible, artículo 78 LIVA. Antes se sumaba
    // al total después del IVA.
    const totals = calcularTotales(items, header.envio ?? 0);

    // Lo que este pedido ya tenía apartado, para no contarlo dos veces al editar.
    const previos = id ? await itemsDelPedido(context.supabase, id) : new Map<string, number>();
    const estadoPrevio = id ? await estadoDelPedido(context.supabase, id) : null;
    const nuevos = agruparStock(items);
    if (header.estado !== "cancelado") {
      await validarDisponibilidad(context.supabase, nuevos, previos);
    }

    const payload = {
      ...header,
      subtotal: totals.subtotal,
      iva: totals.iva,
      total: totals.total,
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

    // Stock. Mientras el pedido no haya salido, lo único que cambia son las
    // reservas y el físico no se toca. En cuanto sale, la aritmética es sobre
    // mercancía de verdad y se anota en el libro.
    const empresaId = await empresaActiva(context.supabase);
    const salioAntes = estadoPrevio !== null && ESTADOS_SALIDA.has(estadoPrevio);
    const saleAhora = ESTADOS_SALIDA.has(header.estado);
    // Un pedido cancelado no aparta nada.
    const objetivo = header.estado === "cancelado" ? new Map<string, number>() : nuevos;

    if (salioAntes && saleAhora) {
      // Ya estaba entregado y se corrige: solo se mueve la diferencia.
      const delta = new Map<string, number>();
      for (const k of new Set([...nuevos.keys(), ...previos.keys()])) {
        const d = (nuevos.get(k) ?? 0) - (previos.get(k) ?? 0);
        if (d !== 0) delta.set(k, d);
      }
      await ajustarStock(context.supabase, delta, empresaId, pedidoId);
    } else if (salioAntes && !saleAhora) {
      // Vuelve atrás: la mercancía regresa a la estantería y queda apartada.
      await ajustarStock(context.supabase, negar(previos), empresaId, pedidoId);
      await sincronizarReservas(context.supabase, pedidoId!, empresaId, objetivo);
    } else {
      await sincronizarReservas(context.supabase, pedidoId!, empresaId, objetivo);
      if (saleAhora) {
        await llamarRpc(context.supabase, "textil_pedido_entregar", { _pedido_id: pedidoId });
      }
    }

    return { id: pedidoId };
  });

export const updateTextilPedidoEstado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), estado: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    // El cambio de estado es lo que mueve el stock de verdad: al marcar
    // «enviado» o «entregado» la mercancía sale, y las reservas se convierten
    // en salidas anotadas en el libro.
    const estadoPrevio = await estadoDelPedido(context.supabase, data.id);
    const salioAntes = estadoPrevio !== null && ESTADOS_SALIDA.has(estadoPrevio);
    const saleAhora = ESTADOS_SALIDA.has(data.estado);
    const empresaId = await empresaActiva(context.supabase);

    if (!salioAntes && saleAhora) {
      await llamarRpc(context.supabase, "textil_pedido_entregar", { _pedido_id: data.id });
    } else if (salioAntes && !saleAhora) {
      // Devolución: vuelve al armario y se vuelve a apartar, salvo que se anule.
      const previos = await itemsDelPedido(context.supabase, data.id);
      await ajustarStock(context.supabase, negar(previos), empresaId, data.id);
      await sincronizarReservas(
        context.supabase,
        data.id,
        empresaId,
        data.estado === "cancelado" ? new Map<string, number>() : previos,
      );
    } else if (data.estado === "cancelado") {
      // Nunca llegó a salir: basta con soltar el compromiso.
      await sincronizarReservas(context.supabase, data.id, empresaId, new Map<string, number>());
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
    // Si la mercancía ya había salido, borrar el pedido tiene que devolverla:
    // el movimiento de venta no se borra, se compensa con una entrada. Las
    // reservas, en cambio, caen solas con el pedido (ON DELETE CASCADE).
    const estado = await estadoDelPedido(context.supabase, data.id);
    if (estado !== null && ESTADOS_SALIDA.has(estado)) {
      const previos = await itemsDelPedido(context.supabase, data.id);
      await ajustarStock(
        context.supabase,
        negar(previos),
        await empresaActiva(context.supabase),
        data.id,
      );
    }
    const { error } = await context.supabase.from("textil_pedidos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============ EMPRESA ============
export const getEmpresaGlobal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await tabla(context.supabase, "empresas")
      .select("*")
      .eq("activa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    return data;
  });
