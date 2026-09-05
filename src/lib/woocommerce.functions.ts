import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { tabla } from "./rpc";
import { numeroPedidoWoo } from "@/dominio/pedido-woo";

/**
 * Sincronizar pedidos, clientes y productos desde WooCommerce.
 * Las credenciales NUNCA viajan al navegador: se leen aquí en el servidor
 * (Cloudflare Worker / TanStack server function) con el cliente de servicio.
 */
/**
 * Convierte un bloque de dirección de WooCommerce al que guarda el pedido.
 *
 * Devuelve `null` cuando el bloque viene vacío, que es lo que hace Woo con
 * `shipping` cuando el envío coincide con la facturación. Un objeto lleno de
 * cadenas vacías no es una dirección y la pantalla lo pintaría como si lo
 * fuera.
 */
function direccionWoo(b: any): Record<string, string> | null {
  if (!b) return null;
  const calle = [b.address_1, b.address_2].filter(Boolean).join(" ").trim();
  const nombre = [b.first_name, b.last_name].filter(Boolean).join(" ").trim();
  const d = {
    nombre,
    empresa: (b.company ?? "").trim(),
    direccion: calle,
    codigo_postal: (b.postcode ?? "").trim(),
    ciudad: (b.city ?? "").trim(),
    provincia: (b.state ?? "").trim(),
    pais: (b.country ?? "").trim(),
    telefono: (b.phone ?? "").trim(),
    email: (b.email ?? "").trim(),
  };
  return Object.values(d).some(Boolean) ? d : null;
}

export const sincronizarWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

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

    const creds = await leerCredencialesWoo(supabaseAdmin, data.tienda_id);
    if (!creds) throw new Error("Faltan credenciales de WooCommerce");

    const base = tienda.woo_url.replace(/\/$/, "");
    const headers = { Authorization: autorizacionWoo(creds), Accept: "application/json" };

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
          // Las direcciones del PEDIDO, no las de la ficha del cliente. Un
          // pedido de invitado no trae customer_id y se quedaba sin nombre ni
          // correo: es el «—» de la columna Cliente. Estos datos sí vienen
          // siempre, dentro de billing.
          const facturacion = direccionWoo(o.billing);
          const envio = direccionWoo(o.shipping);

          // tabla() y no .from(): types.ts está generado y todavía no conoce
          // las columnas de dirección. Se quita cuando se regenere.
          const { data: pedido, error: pErr } = await tabla(supabaseAdmin, "pedidos")
            .upsert(
              {
                tienda_id: data.tienda_id,
                woo_order_id: o.id,
                // El número que ve el cliente, no el id interno de WordPress.
                // En una tienda sin plugins son el mismo; con un plugin de
                // numeración, no, y entonces el número del correo del cliente
                // no coincidía con el de aquí.
                numero: numeroPedidoWoo(o) || String(o.id),
                // Sin esto se quedaba en 'manual', que es el valor por defecto
                // de la columna. No era cosmético: updatePedidoEstado y el aviso
                // de tracking comprueban origen === 'woocommerce' antes de
                // devolver el cambio a la web, así que nunca lo devolvían.
                origen: "woocommerce",
                estado: (estadoMap[o.status] ?? "pendiente") as any,
                cliente_id,
                cliente_nombre: facturacion?.nombre || null,
                cliente_email: facturacion?.email || null,
                cliente_telefono: facturacion?.telefono || null,
                direccion_facturacion: facturacion,
                // Woo manda `shipping` vacío cuando el envío es igual que la
                // facturación. Guardar un objeto de huecos sería peor que no
                // guardar nada: la pantalla lo enseñaría como una dirección.
                direccion_envio: envio ?? facturacion,
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
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

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

    const creds = await leerCredencialesWoo(supabaseAdmin, data.tienda_id);
    if (!creds) throw new Error("Faltan credenciales de WooCommerce");

    const base = tienda.woo_url.replace(/\/$/, "");
    const headers = { Authorization: autorizacionWoo(creds), Accept: "application/json" };

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

/**
 * De dónde sale el número de pedido en ESTA tienda.
 *
 * Existe porque adivinar dónde guarda el número un plugin de WooCommerce
 * cuesta una ronda entera cada vez: hay decenas de plugins de numeración y
 * cada uno usa su clave. Esto trae lo que devuelve la API de verdad, para
 * mirarlo en vez de suponerlo.
 *
 * ## Qué devuelve, y qué no
 *
 * De cada pedido: el `id`, el `number`, y las claves de `meta_data`. El VALOR
 * de un meta solo se devuelve si su clave parece de numeración; del resto se
 * devuelve únicamente el nombre de la clave.
 *
 * No es pudor: en `meta_data` hay NIF, teléfonos y direcciones, y volcarlo
 * entero a una pantalla —y de ahí a una conversación— sería sacar datos
 * personales de clientes sin ninguna necesidad. Para encontrar dónde vive el
 * número basta con ver la lista de claves.
 */
export const diagnosticoNumeroWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

    const { data: tienda } = await supabaseAdmin
      .from("tiendas")
      .select("woo_url")
      .eq("id", data.tienda_id)
      .maybeSingle();
    if (!tienda?.woo_url) throw new Error("Esta tienda no tiene URL de WooCommerce");

    const creds = await leerCredencialesWoo(supabaseAdmin, data.tienda_id);
    if (!creds) throw new Error("Esta tienda no tiene credenciales de WooCommerce guardadas");

    const base = tienda.woo_url.replace(/\/$/, "");
    const r = await fetch(`${base}/wp-json/wc/v3/orders?per_page=3&orderby=date&order=desc`, {
      headers: { Authorization: autorizacionWoo(creds) },
    });
    if (!r.ok) throw new Error(`WooCommerce respondió ${r.status}: ${await r.text()}`);
    const pedidos = (await r.json()) as Record<string, unknown>[];

    // Claves que pueden contener un número de pedido o de factura.
    const pareceNumero = /num|order|invoice|factur|serie|seq|folio/i;

    return {
      pedidos: pedidos.map((o) => {
        const metas = Array.isArray(o.meta_data) ? (o.meta_data as any[]) : [];
        return {
          id: String(o.id ?? ""),
          number: String(o.number ?? ""),
          // Lo que el CRM guardaría hoy con estos datos.
          numero_que_guardaria: numeroPedidoWoo(o as never) || String(o.id ?? ""),
          metas: metas.map((m) => {
            const clave = String(m?.key ?? "");
            const v = m?.value;
            const legible = typeof v === "string" || typeof v === "number" ? String(v) : null;
            const mostrar = pareceNumero.test(clave) && legible !== null;
            return { clave, valor: mostrar ? legible.slice(0, 80) : null };
          }),
        };
      }),
    };
  });
