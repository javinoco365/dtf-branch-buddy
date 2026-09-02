import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcularLinea, calcularTotales, redondear } from "@/dominio/importes";

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
  const { data: creds } = await supabaseAdmin
    .from("tienda_credenciales")
    .select("woo_consumer_key, woo_consumer_secret")
    .eq("tienda_id", tiendaId)
    .maybeSingle();
  if (!creds?.woo_consumer_key || !creds.woo_consumer_secret) return null;
  const auth =
    "Basic " +
    Buffer.from(`${creds.woo_consumer_key}:${creds.woo_consumer_secret}`).toString("base64");
  return { base: tienda.woo_url.replace(/\/$/, ""), auth };
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

    let query = supabase
      .from("pedidos")
      .select(
        "id, tienda_id, woo_order_id, numero, estado, metros_total, subtotal, iva, total, fecha_pedido, notas, cliente_id, cliente_nombre, cliente_email, origen, metodo_pago, envio",
      )
      .gte("fecha_pedido", data.desde)
      .lte("fecha_pedido", data.hasta)
      .order("fecha_pedido", { ascending: false });
    if (data.tiendaId) query = query.eq("tienda_id", data.tiendaId);

    const { data: pedidos, error } = await query;
    if (error) throw error;
    if (!pedidos || pedidos.length === 0) return { pedidos: [] };

    const ids = pedidos.map((p) => p.id);
    const tiendaIds = Array.from(new Set(pedidos.map((p) => p.tienda_id)));
    const clienteIds = pedidos.map((p) => p.cliente_id).filter(Boolean) as string[];

    const [{ data: items }, { data: tiendas }, { data: clientes }, { data: tracking }] =
      await Promise.all([
        supabase
          .from("pedido_items")
          .select(
            "id, pedido_id, descripcion, cantidad, unidad, precio_unitario, subtotal, iva, total",
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

export const createPedidoManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tiendaId: z.string().uuid(),
        cliente_nombre: z.string().min(1),
        cliente_email: z.string().optional().nullable(),
        metodo_pago: z.string().optional().nullable(),
        envio: z.number().nonnegative().default(0),
        notas: z.string().optional().nullable(),
        items: z.array(itemSchema).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureAccess(supabaseAdmin, context.userId, data.tiendaId);

    // Mismo módulo que la pantalla, para que lo que se ve y lo que se guarda
    // coincidan. Sobre el envío, ver la nota de PedidoFormDialog: hoy se suma
    // después del IVA y ese criterio se conserva aquí.
    const totales = calcularTotales(data.items);
    const metros_total = data.items.reduce((s, it) => s + it.cantidad, 0);
    const total = redondear(totales.total + (data.envio || 0));

    const numero = `MAN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      Math.random() * 9000 + 1000,
    )}`;

    const { data: pedido, error: pErr } = await supabaseAdmin
      .from("pedidos")
      .insert({
        tienda_id: data.tiendaId,
        numero,
        estado: "pendiente",
        origen: "manual",
        metodo_pago: data.metodo_pago ?? null,
        envio: data.envio ?? 0,
        cliente_nombre: data.cliente_nombre,
        cliente_email: data.cliente_email ?? null,
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    return { ok: true, woo_synced };
  });

export const updatePedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        cliente_nombre: z.string().optional().nullable(),
        cliente_email: z.string().optional().nullable(),
        metodo_pago: z.string().optional().nullable(),
        envio: z.number().nonnegative().optional(),
        notas: z.string().optional().nullable(),
        items: z.array(itemSchema).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido no encontrado");
    await ensureAccess(supabaseAdmin, context.userId, pedido.tienda_id);

    const patch: {
      cliente_nombre?: string | null;
      cliente_email?: string | null;
      metodo_pago?: string | null;
      envio?: number;
      notas?: string | null;
      subtotal?: number;
      iva?: number;
      metros_total?: number;
      total?: number;
    } = {};
    if (data.cliente_nombre !== undefined) patch.cliente_nombre = data.cliente_nombre;
    if (data.cliente_email !== undefined) patch.cliente_email = data.cliente_email;
    if (data.metodo_pago !== undefined) patch.metodo_pago = data.metodo_pago;
    if (data.envio !== undefined) patch.envio = data.envio;
    if (data.notas !== undefined) patch.notas = data.notas;

    if (data.items && data.items.length) {
      const subtotal = data.items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
      const iva = data.items.reduce(
        (s, it) => s + it.cantidad * it.precio_unitario * (it.iva_rate / 100),
        0,
      );
      const metros_total = data.items.reduce((s, it) => s + it.cantidad, 0);
      const total = subtotal + iva + (data.envio ?? 0);
      patch.subtotal = Number(subtotal.toFixed(2));
      patch.iva = Number(iva.toFixed(2));
      patch.metros_total = metros_total;
      patch.total = Number(total.toFixed(2));

      await supabaseAdmin.from("pedido_items").delete().eq("pedido_id", data.id);
      const itemRows = data.items.map((it) => {
        const sub = it.cantidad * it.precio_unitario;
        const ivaLi = sub * (it.iva_rate / 100);
        return {
          pedido_id: data.id,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: "ud",
          precio_unitario: it.precio_unitario,
          iva_rate: it.iva_rate,
          subtotal: Number(sub.toFixed(2)),
          iva: Number(ivaLi.toFixed(2)),
          total: Number((sub + ivaLi).toFixed(2)),
        };
      });
      await supabaseAdmin.from("pedido_items").insert(itemRows);
    }

    const { error } = await supabaseAdmin.from("pedidos").update(patch).eq("id", data.id);
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
