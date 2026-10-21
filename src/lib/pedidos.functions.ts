import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigeBorrar, exigeEscribir } from "./permisos-middleware";
import { faltaLaColumna, llamarRpc, tabla } from "./rpc";
import { esAdminActivo, esMiembroTienda } from "./acceso";
import { leerListaPedidos } from "./pedidos-lista";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { avisarPedidoEnviado, type ResultadoAviso } from "./correos.functions";
import { calcularLinea, calcularTotales } from "@/dominio/importes";
import { normalizarDireccion } from "@/dominio/direcciones";
import { urlSeguimientoValida } from "@/dominio/transportistas";

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
  if (!(await esMiembroTienda(supabaseAdmin, userId, tiendaId))) {
    throw new Error("Sin acceso a esta tienda");
  }
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

export type { DocumentoDeLista } from "./pedidos-lista";

export const listPedidos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tiendaId: z.string().uuid().optional(),
        /** El primer y el último día del periodo, 'yyyy-mm-dd', los dos incluidos. */
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => leerListaPedidos(context.supabase, data));

/**
 * Corrige a mano el día y la hora en que se realizó un pedido de tienda o
 * textil (lo imprimisteis ayer y lo marcasteis hoy). Pasa por
 * pedido_fijar_realizado(), que comprueba el estado y la fecha y deja el autor
 * en la auditoría; después, ni la sincronización ni el trigger la pisan.
 */
export const fijarRealizadoPedido = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({
        tabla: z.enum(["pedidos", "textil_pedidos"]),
        id: z.string().uuid(),
        realizado_en: z.string().datetime({ offset: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    if (!(await esAdminActivo(supabaseAdmin, context.userId))) {
      throw new Error("Solo un administrador puede corregir la fecha de realizado");
    }
    const realizado = await llamarRpc<string>(supabaseAdmin, "pedido_fijar_realizado", {
      _tabla: data.tabla,
      _id: data.id,
      _realizado: data.realizado_en,
      _usuario_id: context.userId,
    });
    return { realizado_en: realizado };
  });

/**
 * Lo que cobró la agencia por el envío de un pedido, sin IVA. Vacío: se
 * estima con el coste de envío por defecto de Gerencia.
 */
export const fijarCosteEnvioPedido = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({
        tabla: z.enum(["pedidos", "textil_pedidos"]),
        id: z.string().uuid(),
        coste: z.number().min(0).max(1000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    if (!(await esAdminActivo(supabaseAdmin, context.userId))) {
      throw new Error("Solo un administrador puede cambiar el coste del envío");
    }
    const { error } = await tabla(supabaseAdmin, data.tabla)
      .update({ coste_envio_real: data.coste == null ? null : Math.round(data.coste * 100) / 100 })
      .eq("id", data.id);
    if (faltaLaColumna(error)) {
      throw new Error("Falta aplicar la migración 20261027100000_pedidos_realizado.sql");
    }
    if (error) throw new Error(error.message);
    return { ok: true };
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
  .middleware([exigeEscribir])
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
  .middleware([exigeEscribir])
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
  .middleware([exigeEscribir])
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
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({
        pedido_id: z.string().uuid(),
        transportista: z.string().optional().nullable(),
        codigo_seguimiento: z.string().optional().nullable(),
        // Va al correo y a la nota de WooCommerce que recibe el cliente (W9).
        url: z
          .string()
          .trim()
          .refine((v) => v === "" || urlSeguimientoValida(v), {
            message: "La URL de seguimiento tiene que empezar por https:// y ser una web.",
          })
          .transform((v) => v || null)
          .optional()
          .nullable(),
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
  .middleware([exigeBorrar])
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
    // Los cobros automáticos (web y previos) se van con el pedido; los hechos
    // a mano lo impiden (ON DELETE RESTRICT): ese dinero entró.
    if (error?.code === "23503" && error.message.includes("cobros")) {
      throw new Error("Este pedido tiene cobros registrados. Bórralos antes de borrar el pedido.");
    }
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
