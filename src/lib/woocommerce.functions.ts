import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { tabla } from "./rpc";
import { numeroPedidoWoo } from "@/dominio/pedido-woo";
import {
  clientesInvitadosNuevos,
  estadoPagoPorDevolucion,
  fechaMasAntigua,
  pedidosDesaparecidos,
  totalReembolsado,
} from "@/dominio/sync-woo";

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
    const borrados = { pedidos_borrados: 0, protegidos_por_factura: 0 };
    let devolucionesActualizadas = 0;

    // Productos — una sola escritura con todas las filas, no una por producto.
    // Con 100 productos esto eran 100 idas y vueltas a la base; ahora es una.
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/products?per_page=100`, { headers });
      if (r.ok) {
        const items = (await r.json()) as any[];
        const filas = items.map((p) => ({
          tienda_id: data.tienda_id,
          woo_product_id: p.id,
          sku: p.sku || null,
          nombre: p.name,
          descripcion: p.short_description || null,
          precio_unitario: Number(p.price || 0),
          unidad: "m",
          iva_rate: 21,
          activo: p.status === "publish",
        }));
        if (filas.length) {
          const { error } = await supabaseAdmin
            .from("productos")
            .upsert(filas, { onConflict: "tienda_id,woo_product_id" });
          if (!error) importados.productos = filas.length;
        }
      }
    } catch (e) {
      console.error("Woo productos error", e);
    }

    // Clientes — igual, en una sola escritura.
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/customers?per_page=100`, { headers });
      if (r.ok) {
        const items = (await r.json()) as any[];
        const filas = items.map((c) => ({
          tienda_id: data.tienda_id,
          woo_customer_id: c.id,
          nombre: `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || c.email,
          email: c.email || null,
          telefono: c.billing?.phone || null,
          empresa: c.billing?.company || null,
          direccion: [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(" ") || null,
          codigo_postal: c.billing?.postcode || null,
          ciudad: c.billing?.city || null,
          provincia: c.billing?.state || null,
          pais: c.billing?.country || "ES",
        }));
        if (filas.length) {
          const { error } = await supabaseAdmin
            .from("clientes")
            .upsert(filas, { onConflict: "tienda_id,woo_customer_id" });
          if (!error) importados.clientes = filas.length;
        }
      }
    } catch (e) {
      console.error("Woo clientes error", e);
    }

    // Pedidos (últimos 100), sus líneas, los que hayan desaparecido de Woo y
    // los que traigan devoluciones. Todo en un puñado de idas y vueltas a la
    // base en vez de varias por cada pedido.
    try {
      const r = await fetch(`${base}/wp-json/wc/v3/orders?per_page=100&orderby=date&order=desc`, {
        headers,
      });
      if (r.ok) {
        const orders = (await r.json()) as any[];

        // El cliente de cada pedido, en una sola consulta: antes era un
        // SELECT por pedido solo para encontrar su cliente_id.
        const idsClientesWoo = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];
        const clientePorWooId = new Map<number, string>();
        if (idsClientesWoo.length) {
          const { data: clis } = await supabaseAdmin
            .from("clientes")
            .select("id, woo_customer_id")
            .eq("tienda_id", data.tienda_id)
            .in("woo_customer_id", idsClientesWoo);
          for (const c of clis ?? []) {
            if (c.woo_customer_id != null) clientePorWooId.set(c.woo_customer_id, c.id);
          }
        }

        // Los pedidos de invitado —sin customer_id— no salen en /customers, así
        // que sin esto nunca dejaban ficha en Clientes: se guardaban bien en el
        // pedido, pero el comprador desaparecía de la base de clientes en cuanto
        // se cerraba el pedido. Se identifican por correo, en minúsculas para no
        // duplicar a quien escribe su email distinto cada vez.
        const clientePorEmail = new Map<string, string>();
        const emailsInvitados = [
          ...new Set(
            orders
              .filter((o) => !o.customer_id)
              .map((o) => o.billing?.email?.trim().toLowerCase())
              .filter((e): e is string => !!e),
          ),
        ];
        if (emailsInvitados.length) {
          const { data: existentes } = await supabaseAdmin
            .from("clientes")
            .select("id, email")
            .eq("tienda_id", data.tienda_id)
            .not("email", "is", null);
          for (const c of existentes ?? []) {
            if (c.email) clientePorEmail.set(c.email.trim().toLowerCase(), c.id);
          }

          const nuevos = clientesInvitadosNuevos(orders, new Set(clientePorEmail.keys()));
          if (nuevos.length) {
            const { data: creados, error } = await supabaseAdmin
              .from("clientes")
              .insert(
                nuevos.map((c) => ({ tienda_id: data.tienda_id, woo_customer_id: null, ...c })),
              )
              .select("id, email");
            if (!error) {
              for (const c of creados ?? []) {
                if (c.email) clientePorEmail.set(c.email.trim().toLowerCase(), c.id);
              }
              importados.clientes += creados?.length ?? 0;
            }
          }
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

        const filasPedidos = orders.map((o) => {
          const metros_total = (o.line_items || []).reduce(
            (s: number, li: any) => s + Number(li.quantity || 0),
            0,
          );
          // Las direcciones del PEDIDO, no las de la ficha del cliente. Un
          // pedido de invitado no trae customer_id y se quedaba sin nombre ni
          // correo: es el «—» de la columna Cliente. Estos datos sí vienen
          // siempre, dentro de billing.
          const facturacion = direccionWoo(o.billing);
          const envio = direccionWoo(o.shipping);
          return {
            tienda_id: data.tienda_id,
            woo_order_id: o.id,
            // El número que ve el cliente, no el id interno de WordPress. En
            // una tienda sin plugins son el mismo; con un plugin de
            // numeración, no, y entonces el número del correo del cliente no
            // coincidía con el de aquí.
            numero: numeroPedidoWoo(o) || String(o.id),
            // Sin esto se quedaba en 'manual', que es el valor por defecto de
            // la columna. No era cosmético: updatePedidoEstado y el aviso de
            // tracking comprueban origen === 'woocommerce' antes de devolver
            // el cambio a la web, así que nunca lo devolvían.
            origen: "woocommerce",
            estado: (estadoMap[o.status] ?? "pendiente") as any,
            cliente_id: o.customer_id
              ? (clientePorWooId.get(o.customer_id) ?? null)
              : (clientePorEmail.get(o.billing?.email?.trim().toLowerCase() ?? "") ?? null),
            cliente_nombre: facturacion?.nombre || null,
            cliente_email: facturacion?.email || null,
            cliente_telefono: facturacion?.telefono || null,
            direccion_facturacion: facturacion,
            // Woo manda `shipping` vacío cuando el envío es igual que la
            // facturación. Guardar un objeto de huecos sería peor que no
            // guardar nada: la pantalla lo enseñaría como una dirección.
            direccion_envio: envio ?? facturacion,
            metros_total,
            subtotal: Number(o.total || 0) - Number(o.total_tax || 0),
            iva: Number(o.total_tax || 0),
            total: Number(o.total || 0),
            fecha_pedido: o.date_created,
            notas: o.customer_note || null,
          };
        });

        // tabla() y no .from(): types.ts está generado y todavía no conoce las
        // columnas de dirección. Se quita cuando se regenere.
        type FilaPedidoGuardada = { id: string; woo_order_id: number; total: number };
        let pedidosGuardados: FilaPedidoGuardada[] = [];
        let pErr: { message: string } | null = null;
        if (filasPedidos.length) {
          const res = await tabla(supabaseAdmin, "pedidos")
            .upsert(filasPedidos, { onConflict: "tienda_id,woo_order_id" })
            .select("id, woo_order_id, total");
          pedidosGuardados = (res.data ?? []) as FilaPedidoGuardada[];
          pErr = res.error;
        }

        if (!pErr && pedidosGuardados.length) {
          importados.pedidos = pedidosGuardados.length;
          const idPorWooId = new Map(pedidosGuardados.map((p) => [p.woo_order_id, p.id]));
          const idsPedidos = pedidosGuardados.map((p) => p.id);

          // Las líneas de todos los pedidos de esta tanda, borradas y vueltas
          // a escribir de una vez en vez de un borrado y una escritura por
          // pedido.
          await supabaseAdmin.from("pedido_items").delete().in("pedido_id", idsPedidos);
          const todasLasLineas = orders.flatMap((o) => {
            const pedido_id = idPorWooId.get(o.id);
            if (!pedido_id) return [];
            return (o.line_items || []).map((li: any) => {
              const cant = Number(li.quantity || 0);
              const sub = Number(li.subtotal || 0);
              const ivaLi = Number(li.subtotal_tax || 0);
              return {
                pedido_id,
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
          });
          if (todasLasLineas.length) {
            await supabaseAdmin.from("pedido_items").insert(todasLasLineas);
          }

          // --- Devoluciones ---------------------------------------------
          // WooCommerce ya trae los reembolsos de cada pedido dentro de la
          // propia respuesta de /orders (o.refunds), así que esto no hace
          // ninguna llamada extra a la tienda: ni una por pedido, como hacía
          // la sincronización de devoluciones que había antes (y que nadie
          // llamaba: no había ningún botón que la usara).
          const filasDevoluciones: any[] = [];
          const idsReembolsados: string[] = [];
          const idsParciales: string[] = [];
          for (const o of orders) {
            const pedido_id = idPorWooId.get(o.id);
            if (!pedido_id) continue;
            const refunds = Array.isArray(o.refunds) ? o.refunds : [];
            if (!refunds.length) continue;
            for (const rf of refunds) {
              if (rf?.id == null) continue;
              filasDevoluciones.push({
                tienda_id: data.tienda_id,
                pedido_id,
                woo_refund_id: rf.id,
                importe: Math.abs(Number(rf.total || 0)) || 0,
                motivo: rf.reason || null,
              });
            }
            const reembolsado = totalReembolsado(refunds);
            const estado = estadoPagoPorDevolucion(Number(o.total || 0), reembolsado);
            if (estado === "reembolsado") idsReembolsados.push(pedido_id);
            else if (estado === "parcial") idsParciales.push(pedido_id);
          }
          if (filasDevoluciones.length) {
            await supabaseAdmin
              .from("pedido_devoluciones")
              .upsert(filasDevoluciones, { onConflict: "tienda_id,woo_refund_id" });
          }
          if (idsReembolsados.length) {
            await tabla(supabaseAdmin, "pedidos")
              .update({ estado_pago: "reembolsado" })
              .in("id", idsReembolsados);
          }
          if (idsParciales.length) {
            await tabla(supabaseAdmin, "pedidos")
              .update({ estado_pago: "parcial" })
              .in("id", idsParciales);
          }
          devolucionesActualizadas = idsReembolsados.length + idsParciales.length;
        }

        // --- Pedidos borrados en WooCommerce ------------------------------
        // Solo se compara contra pedidos del CRM cuya fecha cae dentro del
        // tramo que Woo acaba de traer: ver la explicación en
        // src/dominio/sync-woo.ts. Un pedido con una factura emitida no se
        // borra nunca — la factura es inmutable, pero el pedido que la
        // originó desaparecería del CRM sin que quedara ni rastro de a qué
        // pedido corresponde.
        const desde = fechaMasAntigua(orders);
        if (desde) {
          const { data: candidatosCrm } = await tabla(supabaseAdmin, "pedidos")
            .select("id, woo_order_id")
            .eq("tienda_id", data.tienda_id)
            .eq("origen", "woocommerce")
            .not("woo_order_id", "is", null)
            .gte("fecha_pedido", desde);

          const desaparecidos = pedidosDesaparecidos(candidatosCrm ?? [], orders);
          if (desaparecidos.length) {
            const { data: facturados } = await tabla(supabaseAdmin, "facturas")
              .select("pedido_id")
              .in(
                "pedido_id",
                desaparecidos.map((p) => p.id),
              );
            const idsFacturados = new Set((facturados ?? []).map((f: any) => f.pedido_id));
            const aBorrar = desaparecidos.filter((p) => !idsFacturados.has(p.id));
            borrados.protegidos_por_factura = desaparecidos.length - aBorrar.length;

            if (aBorrar.length) {
              await tabla(supabaseAdmin, "pedidos")
                .delete()
                .in(
                  "id",
                  aBorrar.map((p) => p.id),
                );
              borrados.pedidos_borrados = aBorrar.length;
            }
          }
        }
      }
    } catch (e) {
      console.error("Woo pedidos error", e);
    }

    return {
      ok: true,
      ...importados,
      ...borrados,
      devoluciones_actualizadas: devolucionesActualizadas,
    };
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
