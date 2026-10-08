import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { faltaLaColumna, tabla } from "./rpc";
import { importesPedidoWoo, numeroPedidoWoo } from "@/dominio/pedido-woo";
import { lineaPedidoWoo, medirLineaWoo, metrosPedidoWoo, type MetaWoo } from "@/dominio/metros-woo";
import { describirMetaWoo } from "@/dominio/diagnostico-lineas-woo";
import { AJUSTES_POR_DEFECTO } from "@/dominio/gerencia";
import {
  clientesInvitadosNuevos,
  estadoPagoPorDevolucion,
  fechaMasAntigua,
  pedidosDesaparecidos,
  totalReembolsado,
} from "@/dominio/sync-woo";

/**
 * La empresa de una tienda. Los clientes son de la empresa, y con la clave de
 * servicio —que ve todas— hay que acotar a mano lo que la RLS acotaría sola.
 */
async function empresaDeTienda(supabaseAdmin: unknown, tiendaId: string): Promise<string> {
  const { data } = await tabla(supabaseAdmin, "tiendas")
    .select("empresa_id")
    .eq("id", tiendaId)
    .maybeSingle();
  if (!data?.empresa_id) throw new Error("La tienda no tiene empresa asignada");
  return data.empresa_id as string;
}

/**
 * El precio por metro (sin IVA) de Ajustes de Gerencia. Sin la tabla o sin la
 * columna, el de por defecto: no se para una sincronización por esto.
 */
async function precioMetroDeEmpresa(supabaseAdmin: unknown, empresaId: string): Promise<number> {
  const { data, error } = await tabla(supabaseAdmin, "gerencia_ajustes")
    .select("precio_metro")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const precio = !error && data?.precio_metro != null ? Number(data.precio_metro) : NaN;
  return precio > 0 ? precio : AJUSTES_POR_DEFECTO.precio_metro;
}

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

/**
 * Todas las páginas de un listado de WooCommerce, no solo la primera.
 *
 * `sincronizarWoo` se queda a propósito en los últimos 100 clientes y 100
 * pedidos: es la sincronización de cada dos por tres, y tiene que ser rápida.
 * Pero eso significa que una tienda con más de 100 clientes registrados, o
 * más de 100 pedidos históricos con compradores de invitado, tiene compradores
 * que esa sincronización nunca llega a ver. Esto es lo que usa
 * `sincronizarClientesWoo` para mirarlos todos, una vez, a demanda.
 *
 * `maxPaginas` corta un bucle que por lo que sea no acabara nunca: con
 * `per_page=100` son 500 páginas → 50.000 filas, muy por encima de lo que va
 * a tener esta tienda.
 */
async function fetchTodasLasPaginasWoo(
  url: string,
  headers: HeadersInit,
  maxPaginas = 500,
): Promise<any[]> {
  const items: any[] = [];
  const sep = url.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPaginas; page++) {
    const r = await fetch(`${url}${sep}per_page=100&page=${page}`, { headers });
    if (!r.ok) {
      if (page === 1) throw new Error(`WooCommerce respondió ${r.status}: ${await r.text()}`);
      break;
    }
    const pagina = (await r.json()) as any[];
    items.push(...pagina);
    if (pagina.length < 100) break;
  }
  return items;
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
    // Aquí y no dentro de los try de abajo: esos solo apuntan el error en la
    // consola, y un fallo al leer la empresa se saltaría los pedidos sin avisar.
    const empresaId = await empresaDeTienda(supabaseAdmin, data.tienda_id);
    // El precio por metro de Ajustes de Gerencia: con él se estiman los metros
    // de una línea del montador que no trae su longitud (ver metros-woo.ts).
    const precioMetro = await precioMetroDeEmpresa(supabaseAdmin, empresaId);

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
          // En toda la empresa, no solo en esta tienda: el cliente es único,
          // y quien ya compró en otra tienda o encargó en el textil no es un
          // cliente nuevo.
          const { data: existentes } = await tabla(supabaseAdmin, "clientes")
            .select("id, email")
            .eq("empresa_id", empresaId)
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
          // Los metros que mide el trabajo (montador), no la cantidad: ver
          // src/dominio/metros-woo.ts.
          const metros_total = metrosPedidoWoo(o.line_items, precioMetro);
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
            // Base con el envío dentro y el envío aparte (ver importesPedidoWoo).
            ...importesPedidoWoo(o),
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
              const sub = Number(li.subtotal || 0);
              const ivaLi = Number(li.subtotal_tax || 0);
              // En metros si es un trabajo del montador (leídos o estimados);
              // en unidades si no.
              const { cantidad, unidad, precio_unitario, metros_origen, precio_metro_usado } =
                lineaPedidoWoo(li, precioMetro);
              return {
                pedido_id,
                descripcion: li.name,
                cantidad,
                unidad,
                precio_unitario,
                iva_rate: 21,
                subtotal: sub,
                iva: ivaLi,
                total: sub + ivaLi,
                metros_origen,
                precio_metro_usado,
              };
            });
          });
          if (todasLasLineas.length) {
            const r = await tabla(supabaseAdmin, "pedido_items").insert(todasLasLineas);
            // Sin la migración 20261020100000 no existen las columnas del
            // origen: se guardan las líneas sin ellas.
            if (faltaLaColumna(r.error)) {
              const sinOrigen = todasLasLineas.map((linea) => {
                const copia: Record<string, unknown> = { ...linea };
                delete copia.metros_origen;
                delete copia.precio_metro_usado;
                return copia;
              });
              await tabla(supabaseAdmin, "pedido_items").insert(sinOrigen);
            }
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
 * Rellenar Clientes con quien la sincronización normal se ha dejado fuera.
 *
 * `sincronizarWoo` solo mira los últimos 100 clientes registrados y los
 * últimos 100 pedidos (de ahí sale también el invitado sin cuenta). En una
 * tienda con más historial que eso, hay compradores —con cuenta o de
 * invitado— que nunca han llegado a tener ficha. Este botón es aparte, para
 * no volver más lenta la sincronización de cada día: recorre TODO lo que
 * tenga la tienda en WooCommerce, una vez, a demanda.
 *
 * No toca pedidos ni productos — de eso ya se encarga `sincronizarWoo`.
 */
export const sincronizarClientesWoo = createServerFn({ method: "POST" })
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

    // --- Todos los clientes con cuenta ------------------------------------
    const customers = await fetchTodasLasPaginasWoo(
      `${base}/wp-json/wc/v3/customers?_fields=id,first_name,last_name,username,email,billing`,
      headers,
    );
    let clientesRegistrados = 0;
    if (customers.length) {
      const filas = customers.map((c) => ({
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
      const { error } = await supabaseAdmin
        .from("clientes")
        .upsert(filas, { onConflict: "tienda_id,woo_customer_id" });
      if (error) throw new Error(`No se pudieron guardar los clientes: ${error.message}`);
      clientesRegistrados = filas.length;
    }

    // --- Todos los pedidos, solo para encontrar invitados sin ficha ------
    // status=any: un invitado que compró una vez y canceló sigue siendo un
    // comprador real. _fields reduce cada pedido a lo mínimo que hace falta
    // aquí, nada de líneas ni totales: esto no toca pedidos.
    const orders = await fetchTodasLasPaginasWoo(
      `${base}/wp-json/wc/v3/orders?status=any&_fields=id,customer_id,billing`,
      headers,
    );

    // En toda la empresa: ver el mismo comentario en sincronizarWoo.
    const { data: existentes } = await tabla(supabaseAdmin, "clientes")
      .select("email")
      .eq("empresa_id", await empresaDeTienda(supabaseAdmin, data.tienda_id))
      .not("email", "is", null);
    const emailsConFicha = new Set(
      ((existentes ?? []) as { email: string }[]).map((c) => c.email.trim().toLowerCase()),
    );

    const nuevosInvitados = clientesInvitadosNuevos(orders, emailsConFicha);
    let clientesInvitados = 0;
    if (nuevosInvitados.length) {
      const { data: creados, error } = await supabaseAdmin
        .from("clientes")
        .insert(
          nuevosInvitados.map((c) => ({ tienda_id: data.tienda_id, woo_customer_id: null, ...c })),
        )
        .select("id");
      if (error) throw new Error(`No se pudieron dar de alta los invitados: ${error.message}`);
      clientesInvitados = creados?.length ?? 0;
    }

    return {
      ok: true,
      clientes_registrados: clientesRegistrados,
      clientes_invitados: clientesInvitados,
      pedidos_revisados: orders.length,
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

/**
 * Qué trae WooCommerce de verdad en las líneas de un pedido, y cuántos metros
 * sacaría el CRM de ellas.
 *
 * Existe porque el panel de WordPress enseña también lo que el montador de DTF
 * pinta con su propio HTML, y eso no llega por la API. Para saber dónde guarda
 * la longitud del trabajo hay que mirar la respuesta real.
 *
 * Solo pide a WooCommerce las líneas (`_fields`): ni nombres, ni direcciones,
 * ni notas del cliente. Y de cada dato de la línea devuelve su descripción
 * (ver describirMetaWoo), no su valor, salvo que sea una medida o un precio.
 */
export const diagnosticoLineasWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        numero: z.string().trim().min(1, "Escribe el número del pedido"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

    // La misma comprobación que la sincronización: de la tienda o administrador.
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
      .select("woo_url")
      .eq("id", data.tienda_id)
      .maybeSingle();
    if (!tienda?.woo_url) throw new Error("Esta tienda no tiene URL de WooCommerce");
    const creds = await leerCredencialesWoo(supabaseAdmin, data.tienda_id);
    if (!creds) throw new Error("Esta tienda no tiene credenciales de WooCommerce guardadas");

    const { data: pedido } = await tabla(supabaseAdmin, "pedidos")
      .select("id, woo_order_id")
      .eq("tienda_id", data.tienda_id)
      .eq("numero", data.numero)
      .maybeSingle();
    if (!pedido?.woo_order_id) {
      throw new Error(`No hay ningún pedido ${data.numero} de WooCommerce en esta tienda`);
    }

    const base = tienda.woo_url.replace(/\/$/, "");
    const r = await fetch(
      `${base}/wp-json/wc/v3/orders/${pedido.woo_order_id}?_fields=id,number,line_items`,
      { headers: { Authorization: autorizacionWoo(creds), Accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`WooCommerce respondió ${r.status}`);
    const o = (await r.json()) as { number?: unknown; line_items?: any[] };

    const precioMetro = await precioMetroDeEmpresa(
      supabaseAdmin,
      await empresaDeTienda(supabaseAdmin, data.tienda_id),
    );
    return {
      numero: String(o.number ?? data.numero),
      precio_metro: precioMetro,
      lineas: (o.line_items ?? []).map((li) => {
        const metas: MetaWoo[] = Array.isArray(li.meta_data) ? li.meta_data : [];
        return {
          nombre: String(li.name ?? ""),
          cantidad: Number(li.quantity ?? 0),
          subtotal: Number(li.subtotal ?? 0),
          metas: metas.map(describirMetaWoo),
          // Lo que guardaría hoy la sincronización.
          calculo: medirLineaWoo(li, precioMetro),
        };
      }),
    };
  });

/**
 * Recupera el envío de los pedidos de WooCommerce sincronizados antes de que
 * se guardara (F1, 7-10-2026): esos se quedaron con `envio` a 0 aunque el
 * cliente pagara portes, y el envío iba escondido dentro de la base. Sin él,
 * la facturación bruta de los meses viejos lleva los portes y la de los nuevos
 * no, y no se pueden comparar.
 *
 * Se hace de cien en cien (una llamada a WooCommerce cada vez) y la pantalla la
 * repite con `desde` hasta que no quedan. Solo toca pedidos con el envío a 0 y
 * solo les pone lo que dice WooCommerce: se puede repetir sin estropear nada.
 */
export const recuperarEnviosWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        /** El último woo_order_id revisado: se sigue a partir de ahí. */
        desde: z.number().int().nonnegative().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

    // La misma comprobación que la sincronización: de la tienda o administrador.
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
      .select("woo_url")
      .eq("id", data.tienda_id)
      .maybeSingle();
    if (!tienda?.woo_url) throw new Error("Esta tienda no tiene URL de WooCommerce");
    const creds = await leerCredencialesWoo(supabaseAdmin, data.tienda_id);
    if (!creds) throw new Error("Esta tienda no tiene credenciales de WooCommerce guardadas");

    const { data: filas, error } = await tabla(supabaseAdmin, "pedidos")
      .select("id, woo_order_id")
      .eq("tienda_id", data.tienda_id)
      .eq("envio", 0)
      .not("woo_order_id", "is", null)
      .gt("woo_order_id", data.desde)
      .order("woo_order_id")
      .limit(100);
    if (error) throw new Error(error.message);
    const pedidos = (filas ?? []) as { id: string; woo_order_id: number }[];
    if (pedidos.length === 0) return { revisados: 0, actualizados: 0, siguiente: null };

    const base = tienda.woo_url.replace(/\/$/, "");
    const ids = pedidos.map((p) => p.woo_order_id).join(",");
    const r = await fetch(
      `${base}/wp-json/wc/v3/orders?include=${ids}&per_page=100&status=any&_fields=id,shipping_total`,
      { headers: { Authorization: autorizacionWoo(creds), Accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`WooCommerce respondió ${r.status}`);
    const ordenes = (await r.json()) as { id: number; shipping_total?: string | number | null }[];
    const envioDe = new Map(ordenes.map((o) => [Number(o.id), importesPedidoWoo(o).envio]));

    let actualizados = 0;
    for (const p of pedidos) {
      const envio = envioDe.get(Number(p.woo_order_id)) ?? 0;
      if (envio <= 0) continue;
      const { error: uErr } = await tabla(supabaseAdmin, "pedidos")
        .update({ envio })
        .eq("id", p.id)
        .eq("envio", 0);
      if (uErr) throw new Error(uErr.message);
      actualizados++;
    }
    return {
      revisados: pedidos.length,
      actualizados,
      siguiente: pedidos.length === 100 ? pedidos[pedidos.length - 1].woo_order_id : null,
    };
  });
