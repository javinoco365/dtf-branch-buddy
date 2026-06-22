import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Sincronizar pedidos, clientes y productos desde WooCommerce.
 * Las credenciales NUNCA viajan al navegador: se leen aquí en el servidor
 * (Cloudflare Worker / TanStack server function) con el cliente de servicio.
 */
export const sincronizarWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verificar pertenencia a la tienda
    const { data: miembro } = await supabaseAdmin
      .from("tienda_usuarios")
      .select("tienda_id")
      .eq("tienda_id", data.tienda_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: rol } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!miembro && !rol) throw new Error("Sin acceso a esta tienda");

    const { data: tienda } = await supabaseAdmin
      .from("tiendas")
      .select("woo_url, sync_enabled, nombre")
      .eq("id", data.tienda_id)
      .maybeSingle();
    if (!tienda?.woo_url) throw new Error("La tienda no tiene URL de WooCommerce");
    if (!tienda.sync_enabled) throw new Error("La sincronización está desactivada");

    const { data: creds } = await supabaseAdmin
      .from("tienda_credenciales")
      .select("consumer_key, consumer_secret")
      .eq("tienda_id", data.tienda_id)
      .maybeSingle();
    if (!creds) throw new Error("Faltan credenciales de WooCommerce");

    const base = tienda.woo_url.replace(/\/$/, "");
    const auth = btoa(`${creds.consumer_key}:${creds.consumer_secret}`);
    const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

    const importados = { pedidos: 0, clientes: 0, productos: 0 };

    // Productos
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/products?per_page=100`, { headers });
      if (r.ok) {
        const items = (await r.json()) as any[];
        for (const p of items) {
          await supabaseAdmin.from("productos").upsert(
            {
              tienda_id: data.tienda_id,
              woo_product_id: p.id,
              sku: p.sku || null,
              nombre: p.name,
              descripcion: p.short_description || null,
              precio_unitario: Number(p.price || 0),
              unidad: "m",
              iva_rate: 21,
              activo: p.status === "publish",
            },
            { onConflict: "tienda_id,woo_product_id" },
          );
          importados.productos++;
        }
      }
    } catch (e) {
      console.error("Woo productos error", e);
    }

    // Clientes
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/customers?per_page=100`, { headers });
      if (r.ok) {
        const items = (await r.json()) as any[];
        for (const c of items) {
          const nombre =
            `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || c.email;
          await supabaseAdmin.from("clientes").upsert(
            {
              tienda_id: data.tienda_id,
              woo_customer_id: c.id,
              nombre,
              email: c.email || null,
              telefono: c.billing?.phone || null,
              empresa: c.billing?.company || null,
              direccion:
                [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(" ") || null,
              codigo_postal: c.billing?.postcode || null,
              ciudad: c.billing?.city || null,
              provincia: c.billing?.state || null,
              pais: c.billing?.country || "ES",
            },
            { onConflict: "tienda_id,woo_customer_id" },
          );
          importados.clientes++;
        }
      }
    } catch (e) {
      console.error("Woo clientes error", e);
    }

    // Pedidos (últimos 100)
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/orders?per_page=100&orderby=date&order=desc`, {
        headers,
      });
      if (r.ok) {
        const orders = (await r.json()) as any[];
        for (const o of orders) {
          let cliente_id: string | null = null;
          if (o.customer_id) {
            const { data: cli } = await supabaseAdmin
              .from("clientes")
              .select("id")
              .eq("tienda_id", data.tienda_id)
              .eq("woo_customer_id", o.customer_id)
              .maybeSingle();
            cliente_id = cli?.id ?? null;
          }
          const estadoMap: Record<string, string> = {
            pending: "pendiente",
            processing: "en_produccion",
            "on-hold": "pendiente",
            completed: "entregado",
            cancelled: "cancelado",
            refunded: "cancelado",
            failed: "cancelado",
          };
          const metros_total = (o.line_items || []).reduce(
            (s: number, li: any) => s + Number(li.quantity || 0),
            0,
          );
          const subtotal = Number(o.total || 0) - Number(o.total_tax || 0);
          const iva = Number(o.total_tax || 0);
          const { data: pedido, error: pErr } = await supabaseAdmin
            .from("pedidos")
            .upsert(
              {
                tienda_id: data.tienda_id,
                woo_order_id: o.id,
                numero: String(o.number || o.id),
                estado: (estadoMap[o.status] ?? "pendiente") as any,
                cliente_id,
                metros_total,
                subtotal,
                iva,
                total: Number(o.total || 0),
                fecha_pedido: o.date_created,
                notas: o.customer_note || null,
              },
              { onConflict: "tienda_id,woo_order_id" },
            )
            .select("id")
            .maybeSingle();
          if (!pErr && pedido) {
            await supabaseAdmin.from("pedido_items").delete().eq("pedido_id", pedido.id);
            const items = (o.line_items || []).map((li: any) => {
              const cant = Number(li.quantity || 0);
              const sub = Number(li.subtotal || 0);
              const ivaLi = Number(li.subtotal_tax || 0);
              return {
                pedido_id: pedido.id,
                descripcion: li.name,
                cantidad: cant,
                unidad: "m",
                precio_unitario: cant > 0 ? sub / cant : 0,
                iva_rate: 21,
                subtotal: sub,
                iva: ivaLi,
                total: sub + ivaLi,
              };
            });
            if (items.length) await supabaseAdmin.from("pedido_items").insert(items);
          }
          importados.pedidos++;
        }
      }
    } catch (e) {
      console.error("Woo pedidos error", e);
    }

    return { ok: true, ...importados };
  });

/**
 * Sincronizar devoluciones (refunds) desde WooCommerce.
 * Recorre los pedidos ya importados de la tienda y trae sus refunds.
 */
export const sincronizarWooDevoluciones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: miembro } = await supabaseAdmin
      .from("tienda_usuarios")
      .select("tienda_id")
      .eq("tienda_id", data.tienda_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: rol } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!miembro && !rol) throw new Error("Sin acceso a esta tienda");

    const { data: tienda } = await supabaseAdmin
      .from("tiendas")
      .select("woo_url, sync_enabled")
      .eq("id", data.tienda_id)
      .maybeSingle();
    if (!tienda?.woo_url) throw new Error("La tienda no tiene URL de WooCommerce");
    if (!tienda.sync_enabled) throw new Error("La sincronización está desactivada");

    const { data: creds } = await supabaseAdmin
      .from("tienda_credenciales")
      .select("consumer_key, consumer_secret")
      .eq("tienda_id", data.tienda_id)
      .maybeSingle();
    if (!creds) throw new Error("Faltan credenciales de WooCommerce");

    const base = tienda.woo_url.replace(/\/$/, "");
    const auth = btoa(`${creds.consumer_key}:${creds.consumer_secret}`);
    const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

    const { data: pedidos } = await supabaseAdmin
      .from("pedidos")
      .select("id, woo_order_id")
      .eq("tienda_id", data.tienda_id)
      .not("woo_order_id", "is", null)
      .order("fecha_pedido", { ascending: false })
      .limit(200);

    let importadas = 0;
    for (const p of pedidos ?? []) {
      try {
        const r = await fetch(
          `${base}/wp-json/wc/v3/orders/${p.woo_order_id}/refunds?per_page=50`,
          { headers },
        );
        if (!r.ok) continue;
        const refunds = (await r.json()) as any[];
        for (const rf of refunds) {
          await supabaseAdmin.from("pedido_devoluciones").upsert(
            {
              tienda_id: data.tienda_id,
              pedido_id: p.id,
              woo_refund_id: rf.id,
              importe: Math.abs(Number(rf.amount || rf.total || 0)),
              motivo: rf.reason || null,
              fecha: rf.date_created || new Date().toISOString(),
            },
            { onConflict: "tienda_id,woo_refund_id" },
          );
          importadas++;
        }
      } catch (e) {
        console.error("Woo refunds error", p.woo_order_id, e);
      }
    }

    return { ok: true, devoluciones: importadas };
  });
