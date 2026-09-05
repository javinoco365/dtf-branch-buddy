import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tabla } from "./rpc";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { avisarPedidoEnviado, type ResultadoAviso } from "./correos.functions";
import { calcularLinea, calcularTotales } from "@/dominio/importes";
import { normalizarDireccion } from "@/dominio/direcciones";

const ESTADO_VALUES = [
  "pendiente",
  "en_produccion",
  "imprimiendo",
  "listo",
  "enviado",
  "entregado",
  "cancelado",
] as const;
type Estado = (typeof ESTADO_VALUES)[number];

const ESTADO_TO_WC: Record<Estado, string> = {
  pendiente: "on-hold",
  en_produccion: "processing",
  imprimiendo: "processing",
  listo: "processing",
  enviado: "completed",
  entregado: "completed",
  cancelado: "cancelled",
};

async function ensureAccess(supabaseAdmin: any, userId: string, tiendaId: string) {
  const { data: miembro } = await supabaseAdmin
    .from("tienda_usuarios")
    .select("tienda_id")
    .eq("tienda_id", tiendaId)
    .eq("user_id", userId)
    .maybeSingle();
  const { data: rol } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!miembro && !rol) throw new Error("Sin acceso a esta tienda");
}

async function getWooCreds(supabaseAdmin: any, tiendaId: string) {
  const { data: tienda } = await supabaseAdmin
    .from("tiendas")
    .select("woo_url, sync_enabled")
    .eq("id", tiendaId)
    .maybeSingle();
  if (!tienda?.woo_url || !tienda.sync_enabled) return null;
  // Iba por woo_consumer_key/woo_consumer_secret, columnas que no existen: se
  // llaman consumer_key/consumer_secret. Devolvía null siempre, así que el
  // empuje del estado del pedido a WooCommerce no ha funcionado nunca.
  const creds = await leerCredencialesWoo(supabaseAdmin, tiendaId);
  if (!creds) return null;
  return { base: tienda.woo_url.replace(/\/$/, ""), auth: autorizacionWoo(creds) };
}

export const listPedidos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tiendaId: z.string().uuid().optional(),
        desde: z.string(),
        hasta: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // tabla() y select("*"): types.ts está generado y no conoce las columnas de
    // dirección, y nombrarlas en el select haría fallar la consulta entera
    // mientras la migración no esté aplicada. Ya pasó una vez con el menú de
    // tiendas: la lista se quedaba vacía sin decir por qué.
    let query = tabla(supabase, "pedidos")
      .select("*")
      .gte("fecha_pedido", data.desde)
      .lte("fecha_pedido", data.hasta)
      .order("fecha_pedido", { ascending: false });
    if (data.tiendaId) query = query.eq("tienda_id", data.tiendaId);

    const { data: filas, error } = await query;
    if (error) throw error;
    if (!filas || filas.length === 0) return { pedidos: [] };
    const pedidos = filas as Record<string, any>[];

    const ids = pedidos.map((p) => p.id);
    const tiendaIds = Array.from(new Set(pedidos.map((p) => p.tienda_id)));
    const clienteIds = pedidos.map((p) => p.cliente_id).filter(Boolean) as string[];

    const [{ data: items }, { data: tiendas }, { data: clientes }, { data: tracking }] =
      await Promise.all([
        supabase
          .from("pedido_items")
          // iva_rate viaja hasta la pantalla: sin él, el formulario de edición
          // no puede saber a qué tipo estaba una línea y la rellena con el 21 %.
          // Una línea al 10 % o al 4 % se convertía en una al 21 % con solo
          // abrir el pedido y guardarlo, sin avisar de nada.
          .select(
            "id, pedido_id, descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total",
          )
          .in("pedido_id", ids),
        supabase.from("tiendas").select("id, nombre").in("id", tiendaIds),
        clienteIds.length
          ? supabase.from("clientes").select("id, nombre, email").in("id", clienteIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("enlaces_seguimiento")
          .select("id, pedido_id, transportista, url, codigo_seguimiento")
          .in("pedido_id", ids),
      ]);

    void userId;
    return {
      pedidos: pedidos.map((p) => {
        const cli = clientes?.find((c: any) => c.id === p.cliente_id);
        return {
          ...p,
          tienda_nombre: tiendas?.find((t: any) => t.id === p.tienda_id)?.nombre ?? null,
          cliente_nombre: p.cliente_nombre ?? cli?.nombre ?? null,
          cliente_email: p.cliente_email ?? cli?.email ?? null,
          items: (items ?? []).filter((it: any) => it.pedido_id === p.id),
          tracking: (tracking ?? []).find((t: any) => t.pedido_id === p.id) ?? null,
        };
      }),
    };
  });

const itemSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().nonnegative(),
  precio_unitario: z.number().nonnegative(),
  iva_rate: z.number().nonnegative().default(21),
});

/**
 * Una dirección tal como llega del formulario: todo opcional y todo texto.
 *
 * Lo que se guarda no es esto, es lo que devuelve `normalizarDireccion`: sin
 * espacios sobrantes, sin campos vacíos y `null` entero si no había nada. Así
 * la columna nunca contiene un objeto que parece una dirección y no lo es.
 */
const direccionSchema = z
  .object({
    nombre: z.string(),
    empresa: z.string(),
    direccion: z.string(),
    codigo_postal: z.string(),
    ciudad: z.string(),
    provincia: z.string(),
    pais: z.string(),
    telefono: z.string(),
    email: z.string(),
  })
  .partial()
  .nullable()
  .optional();

export const createPedidoManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tiendaId: z.string().uuid(),
        cliente_nombre: z.string().min(1),
        cliente_email: z.string().optional().nullable(),
        cliente_telefono: z.string().optional().nullable(),
        direccion_facturacion: direccionSchema,
        direccion_envio: direccionSchema,
        metodo_pago: z.string().optional().nullable(),
        envio: z.number().nonnegative().default(0),
        notas: z.string().optional().nullable(),
        items: z.array(itemSchema).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    await ensureAccess(supabaseAdmin, context.userId, data.tiendaId);

    // Mismo módulo que la pantalla, para que lo que se ve y lo que se guarda
    // coincidan. El envío va dentro, en la base imponible: artículo 78 LIVA.
    const totales = calcularTotales(data.items, { envio: data.envio ?? 0 });
    const metros_total = data.items.reduce((s, it) => s + it.cantidad, 0);
    const total = totales.total;

    const numero = `MAN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      Math.random() * 9000 + 1000,
    )}`;

    // tabla(): types.ts está generado y todavía no conoce cliente_telefono ni
    // las dos columnas de dirección, que las añadió 20260903360000.
    const { data: pedido, error: pErr } = await tabla(supabaseAdmin, "pedidos")
      .insert({
        tienda_id: data.tiendaId,
        numero,
        estado: "pendiente",
        origen: "manual",
        metodo_pago: data.metodo_pago ?? null,
        envio: data.envio ?? 0,
        cliente_nombre: data.cliente_nombre,
        cliente_email: data.cliente_email ?? null,
        cliente_telefono: data.cliente_telefono?.trim() || null,
        direccion_facturacion: normalizarDireccion(data.direccion_facturacion),
        direccion_envio: normalizarDireccion(data.direccion_envio),
        notas: data.notas ?? null,
        metros_total,
        subtotal: totales.base_imponible,
        iva: totales.iva_total,
        total,
      })
      .select("id")
      .single();
    if (pErr || !pedido) throw new Error(pErr?.message || "Error creando pedido");

    const itemRows = data.items.map((it) => {
      const linea = calcularLinea(it);
      return {
        pedido_id: pedido.id,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: "ud",
        precio_unitario: it.precio_unitario,
        iva_rate: it.iva_rate,
        subtotal: linea.base,
        iva: linea.cuota,
        total: linea.total,
      };
    });
    await supabaseAdmin.from("pedido_items").insert(itemRows);
    return { id: pedido.id };
  });

export const updatePedidoEstado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        estado: z.enum(ESTADO_VALUES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id, woo_order_id, origen")
      .eq("id", data.id)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido no encontrado");
    await ensureAccess(supabaseAdmin, context.userId, pedido.tienda_id);

    const { error } = await supabaseAdmin
      .from("pedidos")
      .update({ estado: data.estado })
      .eq("id", data.id);
    if (error) throw error;

    // El aviso al cliente sale aquí, al marcar el pedido como enviado.
    //
    // Después de guardar el estado y sin poder tumbarlo: avisarPedidoEnviado()
    // no lanza nunca. Que el servidor de correo esté caído no puede hacer que
    // el pedido se quede sin marcar. El estado es el dato; el aviso es una
    // consecuencia, y queda registrado tanto si sale como si falla.
    let aviso: ResultadoAviso | null = null;
    if (data.estado === "enviado") {
      aviso = await avisarPedidoEnviado(supabaseAdmin, data.id);
    }

    let woo_synced = false;
    if (pedido.woo_order_id && pedido.origen === "woocommerce") {
      const creds = await getWooCreds(supabaseAdmin, pedido.tienda_id);
      if (creds) {
        try {
          const r = await fetch(`${creds.base}/wp-json/wc/v3/orders/${pedido.woo_order_id}`, {
            method: "PUT",
            headers: { Authorization: creds.auth, "Content-Type": "application/json" },
            body: JSON.stringify({ status: ESTADO_TO_WC[data.estado] }),
          });
          woo_synced = r.ok;
        } catch (e) {
          console.error("Woo update status error", e);
        }
      }
    }
    return { ok: true, woo_synced, aviso };
  });

export const updatePedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        cliente_nombre: z.string().optional().nullable(),
        cliente_email: z.string().optional().nullable(),
        cliente_telefono: z.string().optional().nullable(),
        direccion_facturacion: direccionSchema,
        direccion_envio: direccionSchema,
        metodo_pago: z.string().optional().nullable(),
        envio: z.number().nonnegative().optional(),
        notas: z.string().optional().nullable(),
        items: z.array(itemSchema).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido no encontrado");
    await ensureAccess(supabaseAdmin, context.userId, pedido.tienda_id);

    const patch: Record<string, unknown> = {};
    if (data.cliente_nombre !== undefined) patch.cliente_nombre = data.cliente_nombre;
    if (data.cliente_email !== undefined) patch.cliente_email = data.cliente_email;
    if (data.cliente_telefono !== undefined)
      patch.cliente_telefono = data.cliente_telefono?.trim() || null;
    // Solo se tocan las direcciones si el formulario las manda. Un cliente que
    // no las envíe (una llamada antigua) no debe borrar la dirección de un
    // pedido que sí la tenía.
    if (data.direccion_facturacion !== undefined)
      patch.direccion_facturacion = normalizarDireccion(data.direccion_facturacion);
    if (data.direccion_envio !== undefined)
      patch.direccion_envio = normalizarDireccion(data.direccion_envio);
    if (data.metodo_pago !== undefined) patch.metodo_pago = data.metodo_pago;
    if (data.envio !== undefined) patch.envio = data.envio;
    if (data.notas !== undefined) patch.notas = data.notas;

    if (data.items && data.items.length) {
      // Antes esto calculaba a mano: sumaba las cuotas línea a línea en vez de
      // aplicar el tipo sobre la base agregada, redondeaba con toFixed y no
      // miraba el descuento. Crear un pedido y editarlo daban totales
      // distintos. Ahora las dos vías pasan por el mismo módulo.
      const totales = calcularTotales(data.items, { envio: data.envio ?? 0 });
      const metros_total = data.items.reduce((s, it) => s + it.cantidad, 0);
      patch.subtotal = totales.base_imponible;
      patch.iva = totales.iva_total;
      patch.metros_total = metros_total;
      patch.total = totales.total;

      await supabaseAdmin.from("pedido_items").delete().eq("pedido_id", data.id);
      const itemRows = data.items.map((it) => {
        const linea = calcularLinea(it);
        return {
          pedido_id: data.id,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: "ud",
          precio_unitario: it.precio_unitario,
          iva_rate: it.iva_rate,
          subtotal: linea.base,
          iva: linea.cuota,
          total: linea.total,
        };
      });
      await supabaseAdmin.from("pedido_items").insert(itemRows);
    }

    // tabla(): mismo motivo que en createPedidoManual.
    const { error } = await tabla(supabaseAdmin, "pedidos").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const setPedidoTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        pedido_id: z.string().uuid(),
        transportista: z.string().optional().nullable(),
        codigo_seguimiento: z.string().optional().nullable(),
        url: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id, woo_order_id, origen")
      .eq("id", data.pedido_id)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido no encontrado");
    await ensureAccess(supabaseAdmin, context.userId, pedido.tienda_id);

    const { data: existing } = await supabaseAdmin
      .from("enlaces_seguimiento")
      .select("id")
      .eq("pedido_id", data.pedido_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("enlaces_seguimiento")
        .update({
          transportista: data.transportista ?? null,
          codigo_seguimiento: data.codigo_seguimiento ?? null,
          url: data.url ?? null,
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("enlaces_seguimiento").insert({
        pedido_id: data.pedido_id,
        transportista: data.transportista ?? null,
        codigo_seguimiento: data.codigo_seguimiento ?? null,
        url: data.url ?? null,
      });
    }

    // Añadir nota al pedido WC con la info de tracking
    if (pedido.woo_order_id && pedido.origen === "woocommerce") {
      const creds = await getWooCreds(supabaseAdmin, pedido.tienda_id);
      if (creds) {
        try {
          const nota = [
            data.transportista && `Transportista: ${data.transportista}`,
            data.codigo_seguimiento && `Nº seguimiento: ${data.codigo_seguimiento}`,
            data.url && `URL: ${data.url}`,
          ]
            .filter(Boolean)
            .join(" · ");
          if (nota) {
            await fetch(`${creds.base}/wp-json/wc/v3/orders/${pedido.woo_order_id}/notes`, {
              method: "POST",
              headers: { Authorization: creds.auth, "Content-Type": "application/json" },
              body: JSON.stringify({ note: nota, customer_note: true }),
            });
          }
        } catch (e) {
          console.error("Woo tracking note error", e);
        }
      }
    }
    return { ok: true };
  });

export const deletePedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido no encontrado");
    await ensureAccess(supabaseAdmin, context.userId, pedido.tienda_id);
    const { error } = await supabaseAdmin.from("pedidos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const listTiendasParaPedidos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tiendas")
      .select("id, nombre")
      .order("nombre");
    if (error) throw error;
    return { tiendas: data ?? [] };
  });
