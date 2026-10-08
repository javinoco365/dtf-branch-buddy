import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaTabla, llamarRpc, tabla } from "./rpc";
import { rutaPdfTextil } from "./rutas-pdf";
import { leerTodas } from "./paginar";
import type { Cobro } from "./cobros.functions";
import type { TicketPDFData } from "@/lib/pdf-ticket";
import {
  calcularLinea,
  calcularTotales as calcularTotalesDominio,
  redondear as redondearImporte,
} from "@/dominio/importes";
// El dominio se importa aquí arriba y no con await import() dentro de cada
// función: un módulo que se carga de las dos formas obliga al empaquetador a
// generar un auxiliar que acabó en el arranque del servidor, en una
// importación circular que tiró el panel entero en producción («This page
// didn't load»). Son módulos puros y pequeños: no hay nada que ganar
// cargándolos a demanda.
import { lineasDesdePedido, receptorDesdePedido } from "@/dominio/factura-desde-pedido";
import { LIMITES_TICKET, documentoVigente, esTipoFiscal } from "@/dominio/tickets";
import { fechaDocumentoDePedido } from "@/dominio/fecha-documento";

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
// Desde 20260928100000_clientes_unicos, el textil no tiene lista propia: sus
// clientes son la ficha única de la empresa (`clientes`), la misma que usan
// las tiendas. textil_clientes queda congelada y no se lee ni se escribe.
export const listTextilClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tabla(context.supabase, "clientes").select("*").order("nombre");
    if (error) throw new Error(error.message);
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
      // Editar no toca origen ni tienda: siguen diciendo dónde se dio de alta.
      const { data: row, error } = await tabla(context.supabase, "clientes")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await tabla(context.supabase, "clientes")
      .insert({ ...rest, origen: "textil", tienda_id: null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTextilCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "clientes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ PRESUPUESTOS ============
export const listPresupuestos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const campos = "*, items:textil_presupuesto_items(*), marca:textil_marcas(id,nombre,color)";
    const leer = (select: string) =>
      context.supabase.from("textil_presupuestos").select(select).order("fecha", {
        ascending: false,
      });
    // Con el pedido que salió de cada uno. Sin la migración que añade
    // pedido_id, PostgREST no encuentra la relación (PGRST200): se lee sin él.
    let { data, error } = await leer(`${campos}, pedido:textil_pedidos(numero)`);
    if (error?.code === "PGRST200") ({ data, error } = await leer(campos));
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

/**
 * Numeración de presupuestos y pedidos.
 *
 * Antes esto leía el último número y le sumaba uno desde el navegador. Entre
 * leer y escribir caben otros: dos personas guardando a la vez leían el mismo
 * y la segunda se comía un error de clave duplicada perdiendo el formulario. Y
 * al no filtrar por ejercicio, en enero detrás de PRES-2026-0041 venía
 * PRES-2027-0042 en vez de reiniciar.
 *
 * Ahora el número lo da `siguiente_numero()`, que lo incrementa y lo devuelve
 * en una sola sentencia: no hay ventana por la que colarse.
 *
 * NO SIRVE PARA FACTURAS. El contador admite huecos —si la transacción que
 * cogió el número se deshace, ese número se pierde— y una factura no puede
 * tenerlos. Las facturas van por emitir_factura_textil(), que bloquea la fila
 * de la serie durante toda la emisión.
 */
async function nextNumero(supabase: any, ambito: string, prefijo: string) {
  const ejercicio = new Date().getFullYear();
  const numero = await llamarRpcTextil<number>(supabase, "siguiente_numero", {
    _empresa_id: await empresaActiva(supabase),
    _ambito: ambito,
    _ejercicio: ejercicio,
  });
  return `${prefijo}-${ejercicio}-${String(numero).padStart(4, "0")}`;
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
      // select("*"): pedido_id solo existe con la migración de confirmar.
      const { data: actual } = await context.supabase
        .from("textil_presupuestos")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if ((actual as { pedido_id?: string | null } | null)?.pedido_id) {
        throw new Error("Este presupuesto ya es un pedido: no se puede cambiar.");
      }
      const { error } = await context.supabase
        .from("textil_presupuestos")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
      await context.supabase.from("textil_presupuesto_items").delete().eq("presupuesto_id", id);
    } else {
      const numero = await nextNumero(context.supabase, "textil_presupuesto", "PRES");
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
 * Confirma un presupuesto textil: crea su pedido con las mismas líneas y lo
 * deja aceptado y enlazado. El textil no va por factura: lo que se cobra del
 * pedido va a Cobros, y de ahí a la Facturación Consolidada.
 *
 * El pedido se guarda por el mismo camino que el formulario de pedidos, así
 * que aparta el stock igual y, si no hay existencias, falla igual.
 */
export const confirmarPresupuestoTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pres, error } = await context.supabase
      .from("textil_presupuestos")
      .select("*, items:textil_presupuesto_items(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!pres) throw new Error("Sin acceso a este presupuesto");
    const p = pres as any;
    if (p.pedido_id) throw new Error(`El presupuesto ${p.numero} ya es un pedido`);
    if (p.estado === "rechazado") {
      throw new Error(`El presupuesto ${p.numero} está rechazado: no se confirma`);
    }
    if (!p.items?.length) throw new Error("El presupuesto no tiene líneas");

    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
    const { id: pedidoId } = await guardarPedidoTextil(context.supabase, {
      cliente_id: p.cliente_id ?? null,
      cliente_nombre: p.cliente_nombre ?? null,
      cliente_email: p.cliente_email ?? null,
      marca_id: p.marca_id ?? null,
      fecha,
      estado: "pendiente",
      metodo_pago: null,
      envio: 0,
      notas: [`Del presupuesto ${p.numero}`, p.notas?.trim()].filter(Boolean).join("\n"),
      items: p.items.map((it: any) => ({
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        iva_pct: Number(it.iva_pct),
        stock_id: it.stock_id ?? null,
      })),
    });

    // Solo si nadie lo confirmó mientras tanto.
    const { data: enlazados, error: errEnlace } = await tabla(
      context.supabase,
      "textil_presupuestos",
    )
      .update({ pedido_id: pedidoId, estado: "aceptado" })
      .eq("id", p.id)
      .is("pedido_id", null)
      .select("id");
    if (errEnlace) throw new Error(errEnlace.message);
    if (!enlazados?.length) {
      throw new Error(
        `El presupuesto ${p.numero} se ha confirmado a la vez desde otro sitio: revisa Pedidos por si hay uno de más.`,
      );
    }

    const { data: pedido } = await context.supabase
      .from("textil_pedidos")
      .select("numero")
      .eq("id", pedidoId)
      .maybeSingle();
    return { id: pedidoId, numero: (pedido?.numero as string | undefined) ?? null };
  });

// ============ FACTURAS ============
export const listTextilFacturas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const { data, error } = await leerTodas<any>((a, b) =>
      context.supabase
        .from("textil_facturas")
        .select("*, items:textil_factura_items(*), marca:textil_marcas(id,nombre,color)")
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (error) throw error;
    return data ?? [];
  });

/**
 * Borra una factura textil: un borrador, o la última emitida de su serie
 * (su número lo coge la siguiente). Cualquier otra se corrige con una
 * rectificativa. La base lo comprueba en factura_borrar_ultima y lo dice con
 * un mensaje que se entiende; aquí, después, se quita su PDF.
 */
export const deleteTextilFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const r = await llamarRpc<{ referencia: string | null }>(
      context.supabase,
      "factura_borrar_ultima",
      { _tipo: "textil", _id: data.id },
    );
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    await adminComoUsuario(context.userId)
      .storage.from("facturas")
      .remove([`textil/${data.id}.pdf`, `textil/${data.id}-80mm.pdf`]);
    return { ok: true, referencia: r.referencia };
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
  .handler(async ({ data, context }) => guardarPedidoTextil(context.supabase, data));

/**
 * Alta o edición de un pedido textil, con su stock: reservas mientras no
 * sale, movimientos del libro cuando sale. Lo usan el formulario de pedidos y
 * «Confirmar presupuesto», para que los dos caminos hagan exactamente lo mismo.
 */
async function guardarPedidoTextil(
  supabase: any,
  data: z.infer<typeof pedidoSchema>,
): Promise<{ id: string }> {
  const { items, id, ...header } = data;
  // El envío dentro de la base imponible, artículo 78 LIVA. Antes se sumaba
  // al total después del IVA.
  const totals = calcularTotales(items, header.envio ?? 0);

  // Lo que este pedido ya tenía apartado, para no contarlo dos veces al editar.
  const previos = id ? await itemsDelPedido(supabase, id) : new Map<string, number>();
  const estadoPrevio = id ? await estadoDelPedido(supabase, id) : null;
  const nuevos = agruparStock(items);
  if (header.estado !== "cancelado") {
    await validarDisponibilidad(supabase, nuevos, previos);
  }

  const payload = {
    ...header,
    subtotal: totals.subtotal,
    iva: totals.iva,
    total: totals.total,
  };
  let pedidoId = id;
  if (id) {
    const { error } = await supabase.from("textil_pedidos").update(payload).eq("id", id);
    if (error) throw error;
    await supabase.from("textil_pedido_items").delete().eq("pedido_id", id);
  } else {
    const numero = await nextNumero(supabase, "textil_pedido", "TPD");
    const { data: row, error } = await supabase
      .from("textil_pedidos")
      .insert({ ...payload, numero })
      .select("id")
      .single();
    if (error) throw error;
    pedidoId = row.id;
  }
  const { error: itErr } = await supabase.from("textil_pedido_items").insert(
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
  const empresaId = await empresaActiva(supabase);
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
    await ajustarStock(supabase, delta, empresaId, pedidoId);
  } else if (salioAntes && !saleAhora) {
    // Vuelve atrás: la mercancía regresa a la estantería y queda apartada.
    await ajustarStock(supabase, negar(previos), empresaId, pedidoId);
    await sincronizarReservas(supabase, pedidoId!, empresaId, objetivo);
  } else {
    await sincronizarReservas(supabase, pedidoId!, empresaId, objetivo);
    if (saleAhora) {
      await llamarRpc(supabase, "textil_pedido_entregar", { _pedido_id: pedidoId });
    }
  }

  return { id: pedidoId! };
}

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
    // Antes de tocar el stock: si el pedido tiene cobros la base no dejará
    // borrarlo, y el género ya devuelto se quedaría contado dos veces.
    const { count: cobros, error: errCobros } = await tabla(context.supabase, "cobros")
      .select("id", { count: "exact", head: true })
      .eq("textil_pedido_id", data.id);
    if (errCobros && !faltaLaTabla(errCobros)) throw new Error(errCobros.message);
    if ((cobros ?? 0) > 0) {
      throw new Error("Este pedido tiene cobros registrados. Bórralos antes de borrar el pedido.");
    }

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
    // La base no deja borrar un pedido con cobros (ON DELETE RESTRICT): el
    // dinero entró y tiene que seguir constando de qué pedido era.
    if (error?.code === "23503" && error.message.includes("cobros")) {
      throw new Error("Este pedido tiene cobros registrados. Bórralos antes de borrar el pedido.");
    }
    if (error) throw error;
    return { ok: true };
  });

// ============ COBROS ============
/**
 * Los cobros de los pedidos textil. Son pocos: se leen de una vez y se
 * reparten por pedido en la pantalla. Se registran y se borran con
 * cobros.functions.ts, igual que los de las tiendas.
 *
 * Si la migración todavía no está aplicada, `disponible` sale en falso en vez
 * de romper la lista de pedidos entera.
 */
export const listTextilCobros = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tabla(context.supabase, "cobros")
      .select("*")
      .not("textil_pedido_id", "is", null)
      .order("fecha", { ascending: true })
      .order("created_at", { ascending: true });
    if (faltaLaTabla(error)) return { disponible: false, cobros: [] as Cobro[] };
    if (error) throw new Error(error.message);
    return { disponible: true, cobros: (data ?? []) as Cobro[] };
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

/**
 * Lo que hace falta para imprimir una factura o un ticket textil, sacado de lo
 * que se congeló al emitir. Solo administradores, como hasta ahora.
 */
async function leerDatosPdfTextil(supabaseAdmin: any, facturaId: string, userId: string) {
  const { descargarLogo } = await import("@/lib/logo-descarga");
  const { data: esAdmin } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!esAdmin) throw new Error("Solo un administrador puede generar esta factura");

  const { data: factura } = await tabla(supabaseAdmin, "textil_facturas")
    .select("*")
    .eq("id", facturaId)
    .maybeSingle();
  if (!factura) throw new Error("La factura no existe");
  if (factura.estado === "borrador") {
    throw new Error("La factura todavía es un borrador: emítela antes de generar el PDF.");
  }

  const { data: items } = await supabaseAdmin
    .from("textil_factura_items")
    .select("descripcion, cantidad, precio_unitario, iva_pct, subtotal")
    .eq("factura_id", factura.id);

  // El emisor sale del snapshot y solo de ahí: leerlo de empresas hoy sería
  // arriesgarse a imprimir unos datos fiscales distintos de los emitidos.
  const emisor = (factura.emisor_snapshot ?? {}) as Record<string, string | null>;
  const receptor = (factura.receptor_snapshot ?? {}) as Record<string, string | null>;

  const pdfData: TicketPDFData = {
    nombre_comercial: emisor.nombre_comercial ?? null,
    desglose: Array.isArray(factura.desglose_iva)
      ? (factura.desglose_iva as { tipo: number; base: number; cuota: number }[]).map((r) => ({
          tipo: Number(r.tipo),
          base: Number(r.base),
          cuota: Number(r.cuota),
        }))
      : null,
    referencia: factura.numero,
    // Un ticket dice lo que es: factura simplificada (RD 1619/2012 art. 7.2).
    titulo: factura.tipo === "simplificada" ? "FACTURA SIMPLIFICADA" : undefined,
    logo: await descargarLogo(emisor.logo_url),
    fecha: factura.fecha ?? new Date().toISOString(),
    fecha_vencimiento: factura.vencimiento,
    emisor: {
      nombre: emisor.razon_social ?? emisor.nombre ?? "",
      cif: emisor.cif ?? "",
      direccion: emisor.direccion ?? "",
    },
    cliente: {
      nombre: receptor.nombre ?? factura.cliente_nombre ?? "",
      nif: receptor.nif ?? factura.cliente_nif,
      direccion: receptor.direccion ?? factura.cliente_direccion,
    },
    items: (items ?? []).map((it: any) => {
      const base = Number(it.subtotal ?? 0);
      const iva = redondearImporte((base * Number(it.iva_pct ?? 0)) / 100);
      return {
        descripcion: it.descripcion ?? "",
        cantidad: Number(it.cantidad ?? 0),
        unidad: "ud",
        precio_unitario: Number(it.precio_unitario ?? 0),
        iva_rate: Number(it.iva_pct ?? 0),
        subtotal: base,
        iva,
        total: redondearImporte(base + iva),
      };
    }),
    base_imponible: Number(factura.subtotal ?? 0),
    iva_total: Number(factura.iva ?? 0),
    total: Number(factura.total ?? 0),
    notas: factura.notas,
  };

  return { factura, pdfData };
}

/**
 * ¿El error de Storage es «ese fichero ya existe»? (409, «The resource already
 * exists»). Solo ese: un «no existe» o cualquier otro fallo no puede pasar por
 * «ya estaba guardado», o la fila apuntaría a un fichero que no hay.
 */
const yaExiste = (e: { message?: string; statusCode?: string | number } | null) =>
  !!e && (String(e.statusCode) === "409" || /already exists|duplicate/i.test(e.message ?? ""));

/**
 * Genera el PDF de una factura textil y lo deja en Storage, si todavía no
 * está.
 *
 * Reutiliza el mismo generador que las facturas de DTF: una factura de la
 * misma sociedad debe salir con la misma cara, y tener dos maquetadores es
 * garantizar que dentro de un año no se parezcan.
 *
 * Lo que cambia es de dónde sale la identidad: el emisor es siempre RONOCA, y
 * el logo es el de la MARCA, congelado en emisor_snapshot cuando se emitió. Una
 * factura tiene que imprimirse como se emitió aunque la marca cambie de logo
 * después.
 *
 * El primero que se guarda es el definitivo: no se sobrescribe nunca. Se
 * guarda la ruta, no una URL firmada: las URL caducan, y guardar una de un
 * año en la base es guardar un enlace que un día deja de funcionar sin que
 * nadie se entere. La URL se pide al abrir.
 *
 * `sb` es el cliente de servicio con el autor puesto (adminComoUsuario).
 */
async function guardarPdfTextil(sb: any, facturaId: string, userId: string): Promise<string> {
  const { generarFacturaPDF } = await import("@/lib/pdf-factura");
  const { factura, pdfData } = await leerDatosPdfTextil(sb, facturaId, userId);

  const blob = await generarFacturaPDF(pdfData);
  const ruta = rutaPdfTextil(factura.id);
  const { error: subErr } = await sb.storage
    .from("facturas")
    .upload(ruta, new Uint8Array(await blob.arrayBuffer()), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (subErr && !yaExiste(subErr)) throw new Error(`No se pudo guardar el PDF: ${subErr.message}`);

  const { error: updErr } = await tabla(sb, "textil_facturas")
    .update({ pdf_path: ruta })
    .eq("id", factura.id);
  if (updErr) throw new Error(updErr.message);
  return ruta;
}

/**
 * Después de emitir: guarda el PDF, pero un fallo aquí no deshace nada. La
 * factura ya está emitida y numerada; el PDF se puede generar después.
 */
async function guardarPdfTextilTrasEmitir(userId: string, facturaId: string): Promise<boolean> {
  try {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    await guardarPdfTextil(adminComoUsuario(userId), facturaId, userId);
    return true;
  } catch (e) {
    console.error("PDF de la factura textil", facturaId, e);
    return false;
  }
}

export const generarPdfFacturaTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const ruta = await guardarPdfTextil(
      adminComoUsuario(context.userId),
      data.factura_id,
      context.userId,
    );
    return { ruta };
  });

/**
 * Guarda el PDF de las facturas y tickets textil que todavía no lo tienen, de
 * pocos en pocos para no pasarse del tiempo de una función. La pantalla la
 * llama hasta que no quedan.
 */
export const rellenarPdfsTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        /** Solo estas (el archivo, antes de empaquetar). */
        ids: z.array(z.string().uuid()).max(10).optional(),
        /** Las que ya fallaron en esta tanda de tandas: no se reintentan. */
        excluir: z.array(z.string().uuid()).max(100).optional(),
        limite: z.number().int().min(1).max(10).default(5),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let consulta = tabla(context.supabase, "textil_facturas")
      .select("id, numero", { count: "exact" })
      .neq("estado", "borrador")
      .is("pdf_path", null)
      .order("fecha")
      .order("id")
      .limit(data.limite);
    if (data.ids?.length) consulta = consulta.in("id", data.ids);
    if (data.excluir?.length) consulta = consulta.not("id", "in", `(${data.excluir.join(",")})`);
    const { data: filas, count, error } = await consulta;
    if (error) throw new Error(error.message);

    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const sb = adminComoUsuario(context.userId);
    let generados = 0;
    const fallidos: { id: string; referencia: string; motivo: string }[] = [];
    for (const f of (filas ?? []) as { id: string; numero: string | null }[]) {
      try {
        await guardarPdfTextil(sb, f.id, context.userId);
        generados++;
      } catch (e) {
        fallidos.push({ id: f.id, referencia: f.numero ?? f.id, motivo: (e as Error).message });
      }
    }
    return {
      generados,
      fallidos,
      quedan: Math.max(0, (count ?? 0) - generados - fallidos.length),
    };
  });

/** Una URL de un rato para abrir o descargar el PDF. */
export const urlFacturaTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

    const { data: factura } = await tabla(supabaseAdmin, "textil_facturas")
      .select("pdf_path")
      .eq("id", data.factura_id)
      .maybeSingle();
    if (!factura?.pdf_path) return { url: null };

    const { data: firmada } = await supabaseAdmin.storage
      .from("facturas")
      .createSignedUrl(factura.pdf_path, 60 * 10);
    return { url: firmada?.signedUrl ?? null };
  });

// ============ TICKET O FACTURA DE UN PEDIDO ============
//
// Lo mismo que en las tiendas (src/lib/facturas.functions.ts), para pedidos
// textil. Es opcional: nada obliga a emitir, y nada se emite solo. Qué toca lo
// decide decidirDocumento(); el límite y un documento por pedido los impone la
// base en emitir_factura_textil().

/** Todo lo que hace falta para el documento de un pedido textil. Solo lee. */
async function leerPedidoTextilParaDocumento(supabase: any, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("textil_pedidos")
    .select("id, numero, cliente_id, cliente_nombre, cliente_email, marca_id, envio, notas, fecha")
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) throw error;
  if (!pedido) throw new Error("Pedido no encontrado");

  const [{ data: items }, { data: docs }, clienteRes, { data: empresa }] = await Promise.all([
    supabase
      .from("textil_pedido_items")
      .select("descripcion, cantidad, precio_unitario, iva_pct")
      .eq("pedido_id", pedidoId),
    tabla(supabase, "textil_facturas")
      .select("id, numero, tipo, estado, rectifica_a_id")
      .eq("textil_pedido_id", pedidoId),
    pedido.cliente_id
      ? tabla(supabase, "clientes")
          .select(
            "nombre, nif, direccion, codigo_postal, ciudad, provincia, pais, email, tipo_fiscal",
          )
          .eq("id", pedido.cliente_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tabla(supabase, "empresas")
      .select("limite_simplificada, limite_simplificada_particular")
      .eq("activa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);

  const lista = (docs ?? []) as {
    id: string;
    numero: string;
    tipo: "ordinaria" | "rectificativa" | "simplificada";
    estado: string | null;
    rectifica_a_id: string | null;
  }[];
  const ids = lista.map((d) => d.id);
  const { data: rect } = ids.length
    ? await tabla(supabase, "textil_facturas").select("rectifica_a_id").in("rectifica_a_id", ids)
    : { data: [] };
  const vigente = documentoVigente(
    lista,
    (rect ?? []).map((r: { rectifica_a_id: string }) => r.rectifica_a_id),
  );

  const receptor = receptorDesdePedido(
    clienteRes.data,
    null,
    pedido.cliente_nombre,
    pedido.cliente_email,
  );
  const lineas = lineasDesdePedido(
    ((items ?? []) as any[]).map((it) => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad),
      unidad: "ud",
      precio_unitario: Number(it.precio_unitario),
      iva_rate: Number(it.iva_pct),
    })),
    Number(pedido.envio || 0),
  );
  const general = Number(empresa?.limite_simplificada);
  const particular = Number(empresa?.limite_simplificada_particular);
  const limites = general > 0 && particular > 0 ? { general, particular } : LIMITES_TICKET;
  const tipoFiscal = esTipoFiscal(clienteRes.data?.tipo_fiscal)
    ? (clienteRes.data.tipo_fiscal as "particular" | "profesional")
    : null;

  return { pedido, vigente, receptor, lineas, limites, tipoFiscal };
}

/** Lo que el diálogo necesita para proponer ticket o factura. Solo lee. */
export const prepararDocumentoTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ textil_pedido_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { pedido, vigente, receptor, lineas, limites, tipoFiscal } =
      await leerPedidoTextilParaDocumento(context.supabase, data.textil_pedido_id);

    if (vigente) {
      return {
        ya_facturado: true as const,
        factura: { id: vigente.id, tipo: vigente.tipo, referencia: vigente.numero },
      };
    }
    if (lineas.length === 0) {
      throw new Error("Este pedido no tiene líneas: no hay nada que documentar.");
    }
    return {
      ya_facturado: false as const,
      receptor,
      lineas,
      total: calcularTotalesDominio(lineas).total,
      tipo_fiscal: tipoFiscal,
      limites,
      notas: (pedido.notas as string | null) ?? null,
      // El documento sale, por defecto, con la fecha del pedido.
      fecha_pedido: fechaDocumentoDePedido(pedido.fecha as string | null),
    };
  });

/**
 * Emite el ticket o la factura de un pedido textil.
 *
 * Las líneas se vuelven a leer del pedido aquí, en el servidor: del navegador
 * solo llega qué documento y los datos del cliente. La marca del pedido pone
 * el nombre comercial y el logo; la identidad fiscal es la de la sociedad.
 */
export const emitirDocumentoTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        textil_pedido_id: z.string().uuid(),
        documento: z.enum(["ticket", "factura"]),
        nombre: z.string().nullable().optional(),
        nif: z.string().nullable().optional(),
        direccion: z.string().nullable().optional(),
        tipo_fiscal: z.enum(["particular", "profesional"]).nullable().optional(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notas: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pedido, vigente, receptor, lineas } = await leerPedidoTextilParaDocumento(
      context.supabase,
      data.textil_pedido_id,
    );
    if (vigente) throw new Error(`El pedido ya tiene el documento ${vigente.numero}.`);
    if (lineas.length === 0) throw new Error("Este pedido no tiene líneas.");

    const nombre = data.nombre?.trim() || "";
    let receptorEmision: Record<string, string>;
    if (data.documento === "ticket") {
      // El ticket no lleva NIF: si el cliente lo da, lo que toca es factura.
      receptorEmision = {};
      if (nombre) receptorEmision.nombre = nombre;
      if (data.tipo_fiscal) receptorEmision.tipo_fiscal = data.tipo_fiscal;
    } else {
      if (!nombre) throw new Error("Una factura necesita el nombre del cliente");
      receptorEmision = Object.fromEntries(
        Object.entries({
          ...receptor,
          nombre,
          nif: data.nif?.trim() || null,
          direccion: data.direccion?.trim() || null,
        }).filter(([, v]) => v != null && v !== ""),
      ) as Record<string, string>;
    }

    const r = await llamarRpcTextil<{ id: string; referencia: string }>(
      supabaseAdmin,
      "emitir_factura_textil",
      {
        _usuario_id: context.userId,
        _receptor: receptorEmision,
        _lineas: lineas,
        _marca_id: pedido.marca_id ?? null,
        _fecha: data.fecha,
        _cliente_id: pedido.cliente_id ?? null,
        _notas: data.notas?.trim() || null,
        _simplificada: data.documento === "ticket",
        _textil_pedido_id: data.textil_pedido_id,
      },
    );
    return { ...r, pdf_guardado: await guardarPdfTextilTrasEmitir(context.userId, r.id) };
  });

/** El ticket textil en 80 mm, para la impresora térmica. URL de un rato. */
export const generarTicket80Textil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { generarTicketPDF } = await import("@/lib/pdf-ticket");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { factura, pdfData } = await leerDatosPdfTextil(
      supabaseAdmin,
      data.factura_id,
      context.userId,
    );

    const blob = await generarTicketPDF(pdfData);
    const ruta = `textil/${factura.id}-80mm.pdf`;
    const { error } = await supabaseAdmin.storage
      .from("facturas")
      .upload(ruta, new Uint8Array(await blob.arrayBuffer()), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (error) throw new Error(`No se pudo guardar el ticket: ${error.message}`);
    const { data: firmada } = await supabaseAdmin.storage
      .from("facturas")
      .createSignedUrl(ruta, 60 * 10);
    return { url: (firmada?.signedUrl as string | undefined) ?? null };
  });

// ============ CANJE Y ANULACIÓN DE TICKETS ============

/** Una línea congelada, lista para volver a emitirse igual (o en negativo). */
function lineasDeSnapshotTextil(snapshot: unknown, signo: 1 | -1 = 1) {
  return ((Array.isArray(snapshot) ? snapshot : []) as any[]).map((l) => ({
    descripcion: String(l.descripcion ?? ""),
    cantidad: signo * Number(l.cantidad ?? 0),
    unidad: String(l.unidad ?? "ud"),
    precio_unitario: Number(l.precio_unitario ?? 0),
    iva_rate: Number(l.iva_rate ?? 0),
  }));
}

async function leerTicketTextil(supabase: any, facturaId: string) {
  const { data: ticket } = await tabla(supabase, "textil_facturas")
    .select(
      "id, numero, tipo, cliente_id, marca_id, textil_pedido_id, lineas_snapshot, receptor_snapshot",
    )
    .eq("id", facturaId)
    .maybeSingle();
  if (!ticket) throw new Error("El ticket no existe");
  if (ticket.tipo !== "simplificada") throw new Error("Esto solo vale para tickets");
  return ticket;
}

/**
 * Canjea un ticket textil por una factura completa (en Verifactu, F3): mismas
 * líneas, datos fiscales del cliente, el ticket intacto. La base comprueba el
 * resto.
 */
export const canjearTicketTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        factura_id: z.string().uuid(),
        nombre: z.string().trim().min(1, "El canje necesita el nombre del cliente"),
        nif: z.string().trim().min(1, "El canje necesita el NIF del cliente"),
        direccion: z.string().trim().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ticket = await leerTicketTextil(context.supabase, data.factura_id);
    const receptor: Record<string, string> = { nombre: data.nombre, nif: data.nif };
    if (data.direccion) receptor.direccion = data.direccion;
    const r = await llamarRpcTextil<{ id: string; referencia: string }>(
      supabaseAdmin,
      "emitir_factura_textil",
      {
        _usuario_id: context.userId,
        _receptor: receptor,
        _lineas: lineasDeSnapshotTextil(ticket.lineas_snapshot),
        _marca_id: ticket.marca_id ?? null,
        _fecha: new Date().toISOString().slice(0, 10),
        _cliente_id: ticket.cliente_id ?? null,
        _sustituye_a_id: ticket.id,
      },
    );
    return { ...r, pdf_guardado: await guardarPdfTextilTrasEmitir(context.userId, r.id) };
  });

/**
 * Anula un ticket textil con su rectificativa (R5, la de las facturas
 * simplificadas): las mismas líneas en negativo. El ticket no se borra ni se
 * modifica; los dos quedan en el libro y suman cero.
 */
export const anularTicketTextil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ticket = await leerTicketTextil(context.supabase, data.factura_id);

    const [{ data: rect }, { data: canje }] = await Promise.all([
      tabla(context.supabase, "textil_facturas")
        .select("numero")
        .eq("rectifica_a_id", ticket.id)
        .maybeSingle(),
      tabla(context.supabase, "textil_facturas")
        .select("numero")
        .eq("sustituye_a_id", ticket.id)
        .maybeSingle(),
    ]);
    if (rect) throw new Error(`El ticket ${ticket.numero} ya está anulado con ${rect.numero}`);
    if (canje) {
      throw new Error(
        `El ticket ${ticket.numero} se canjeó por la factura ${canje.numero}: rectifica esa.`,
      );
    }

    const r = await llamarRpcTextil<{ id: string; referencia: string }>(
      supabaseAdmin,
      "emitir_factura_textil",
      {
        _usuario_id: context.userId,
        _receptor: ticket.receptor_snapshot ?? {},
        _lineas: lineasDeSnapshotTextil(ticket.lineas_snapshot, -1),
        _marca_id: ticket.marca_id ?? null,
        _fecha: new Date().toISOString().slice(0, 10),
        _cliente_id: ticket.cliente_id ?? null,
        _notas: `Anulación del ticket ${ticket.numero}`,
        _rectifica_a_id: ticket.id,
        _motivo_rectificacion: "R5",
        _textil_pedido_id: ticket.textil_pedido_id ?? null,
      },
    );
    return { ...r, pdf_guardado: await guardarPdfTextilTrasEmitir(context.userId, r.id) };
  });
