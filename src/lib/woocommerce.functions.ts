import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { numero } from "./format";
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
import {
  PAGINAS_MAX_CATALOGO,
  PAGINA_MAXIMA_WOO,
  POR_PAGINA_WOO,
  avanzarCursor,
  clientesNuevosDePagina,
  cursorDesdeUltimoPedido,
  fechaGmtWoo,
  filtroDeFechaIgnorado,
  otraPaginaEnEstaTanda,
  parametrosPaginaWoo,
  quedanTrasPagina,
  totalDeCabecera,
  type CursorWoo,
} from "@/dominio/cursor-woo";

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
 * Lo usa `sincronizarClientesWoo` para mirar TODOS los clientes y pedidos de
 * la tienda, una vez, a demanda. `sincronizarWoo` no lo usa: recorre por
 * tandas desde la última sincronización (ver src/dominio/cursor-woo.ts).
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

/** La URL de un listado de la API de WooCommerce, con sus parámetros. */
function urlWoo(base: string, ruta: string, parametros: Record<string, string>): string {
  return `${base}/wp-json/wc/v3/${ruta}?${new URLSearchParams(parametros).toString()}`;
}

/**
 * Una página de un listado de WooCommerce y el total de la consulta
 * (`X-WP-Total`). Si WooCommerce responde con un error, se lanza diciendo qué
 * se estaba pidiendo: callarlo dejaría la sincronización a medias sin avisar.
 */
async function paginaWoo(
  url: string,
  headers: HeadersInit,
  que: string,
): Promise<{ items: any[]; total: number | null }> {
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const texto = (await r.text()).slice(0, 300);
    throw new Error(`WooCommerce respondió ${r.status} al pedir ${que}: ${texto}`);
  }
  const items = (await r.json()) as unknown;
  if (!Array.isArray(items)) {
    throw new Error(`WooCommerce no ha devuelto una lista al pedir ${que}`);
  }
  return { items, total: totalDeCabecera(r.headers.get("X-WP-Total")) };
}

const VERSION_WOO_ANTIGUA =
  "WooCommerce no ha filtrado por fecha de modificación: hace falta WooCommerce 5.8 o " +
  "posterior. No se ha sincronizado nada más para no repetir siempre lo mismo.";

/** Lo que la sincronización necesita de la tienda en cada paso. */
type ContextoSync = {
  /** El cliente de servicio, con el usuario puesto (adminComoUsuario). */
  sb: unknown;
  tiendaId: string;
  empresaId: string;
  precioMetro: number;
  base: string;
  headers: Record<string, string>;
  /**
   * Correo (en minúsculas) → id de cliente de la empresa. Se lee una vez por
   * llamada, la primera vez que un pedido de invitado lo necesita.
   */
  clientePorEmail: Map<string, string> | null;
  avisos: string[];
};

/** Por dónde iba la sincronización, si la migración 20261024100000 está aplicada. */
type CursorGuardado = {
  disponible: boolean;
  pedidos_hasta: string | null;
  productos_hasta: string | null;
};

async function leerCursorGuardado(sb: unknown, tiendaId: string): Promise<CursorGuardado> {
  const { data, error } = await tabla(sb, "woo_sincronizacion")
    .select("pedidos_hasta, productos_hasta")
    .eq("tienda_id", tiendaId)
    .maybeSingle();
  if (faltaLaTabla(error)) return { disponible: false, pedidos_hasta: null, productos_hasta: null };
  if (error) throw new Error(`No se pudo leer por dónde iba la sincronización: ${error.message}`);
  // La base devuelve «+00:00»; el cursor va siempre en ISO con «Z».
  return {
    disponible: true,
    pedidos_hasta: fechaGmtWoo(data?.pedidos_hasta),
    productos_hasta: fechaGmtWoo(data?.productos_hasta),
  };
}

/**
 * Deja el cursor donde se ha quedado. Si no se puede, no se para nada: la
 * siguiente sincronización empezará algo antes y lo repetido se guarda igual.
 */
async function guardarCursor(
  ctx: ContextoSync,
  campos: { pedidos_hasta?: string | null; productos_hasta?: string | null },
): Promise<void> {
  const { error } = await tabla(ctx.sb, "woo_sincronizacion").upsert(
    { tienda_id: ctx.tiendaId, empresa_id: ctx.empresaId, ...campos },
    { onConflict: "tienda_id" },
  );
  if (error && !faltaLaTabla(error)) {
    ctx.avisos.push(
      `No se pudo guardar por dónde va la sincronización (${error.message}). ` +
        "La próxima empezará algo antes; no se pierde nada.",
    );
  }
}

/**
 * Desde dónde pedir los pedidos sin cursor guardado: un día antes del pedido
 * de WooCommerce más reciente que ya está aquí (ver cursorDesdeUltimoPedido).
 */
async function cursorDesdeLosPedidos(ctx: ContextoSync): Promise<string | null> {
  const { data, error } = await tabla(ctx.sb, "pedidos")
    .select("fecha_pedido")
    .eq("tienda_id", ctx.tiendaId)
    .not("woo_order_id", "is", null)
    .order("fecha_pedido", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el último pedido de la tienda: ${error.message}`);
  return cursorDesdeUltimoPedido(data?.fecha_pedido ?? null, new Date());
}

/** La ficha de un cliente con cuenta en WooCommerce, como la guarda la sincronización. */
function filaClienteRegistrado(c: any, tiendaId: string) {
  return {
    tienda_id: tiendaId,
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
  };
}

/** Lo que hace falta de un cliente de WooCommerce (`_fields`). */
const CAMPOS_CLIENTE_WOO = "id,first_name,last_name,username,email,billing";

/**
 * Productos modificados en WooCommerce desde la última vez, todas las páginas
 * (hasta PAGINAS_MAX_CATALOGO). Una sola escritura por página.
 */
async function sincronizarProductosWoo(
  ctx: ContextoSync,
  desde: string | null,
): Promise<{ guardados: number; hasta: string | null }> {
  let cursor: CursorWoo = { desde, pagina: 1 };
  const vistos = new Set<number>();
  for (let paginas = 0; ; paginas++) {
    if (paginas >= PAGINAS_MAX_CATALOGO) {
      ctx.avisos.push(
        `Hay más de ${numero(PAGINAS_MAX_CATALOGO * POR_PAGINA_WOO, 0)} productos cambiados en ` +
          "WooCommerce: el resto llega en la próxima sincronización.",
      );
      return { guardados: vistos.size, hasta: cursor.desde };
    }
    const { items } = await paginaWoo(
      urlWoo(ctx.base, "products", {
        ...parametrosPaginaWoo(cursor),
        _fields: "id,sku,name,short_description,price,status,date_modified_gmt,date_created_gmt",
      }),
      ctx.headers,
      "los productos",
    );
    if (filtroDeFechaIgnorado(cursor, items)) throw new Error(VERSION_WOO_ANTIGUA);
    if (items.length) {
      const filas = items.map((p) => ({
        tienda_id: ctx.tiendaId,
        woo_product_id: p.id,
        sku: p.sku || null,
        nombre: p.name,
        descripcion: p.short_description || null,
        precio_unitario: Number(p.price || 0),
        unidad: "m",
        iva_rate: 21,
        activo: p.status === "publish",
      }));
      const { error } = await tabla(ctx.sb, "productos").upsert(filas, {
        onConflict: "tienda_id,woo_product_id",
      });
      if (error) throw new Error(`No se pudieron guardar los productos: ${error.message}`);
      for (const p of items) vistos.add(Number(p.id));
    }
    const avance = avanzarCursor(cursor, items);
    cursor = avance.siguiente;
    if (avance.fin) return { guardados: vistos.size, hasta: cursor.desde };
  }
}

/**
 * Los clientes que se han dado de alta en WooCommerce desde la última vez.
 *
 * WooCommerce no deja pedir clientes por fecha, pero el id de un cliente nuevo
 * es siempre mayor que el de los anteriores: se piden de mayor a menor hasta
 * llegar al más alto que ya está aquí. Se guardan igual que siempre (upsert
 * por tienda_id + woo_customer_id).
 */
async function sincronizarClientesNuevosWoo(ctx: ContextoSync): Promise<number> {
  const { data: ultimo, error } = await tabla(ctx.sb, "clientes")
    .select("woo_customer_id")
    .eq("tienda_id", ctx.tiendaId)
    .not("woo_customer_id", "is", null)
    .order("woo_customer_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el último cliente de la tienda: ${error.message}`);
  const hastaId = ultimo?.woo_customer_id != null ? Number(ultimo.woo_customer_id) : null;

  let guardados = 0;
  for (let pagina = 1; ; pagina++) {
    if (pagina > PAGINAS_MAX_CATALOGO) {
      ctx.avisos.push(
        `Hay más de ${numero(PAGINAS_MAX_CATALOGO * POR_PAGINA_WOO, 0)} clientes nuevos en ` +
          "WooCommerce: han llegado los más recientes. Para traer el resto, «Sincronizar " +
          "clientes» en los ajustes de la tienda.",
      );
      return guardados;
    }
    const { items } = await paginaWoo(
      urlWoo(ctx.base, "customers", {
        orderby: "id",
        order: "desc",
        per_page: String(POR_PAGINA_WOO),
        page: String(pagina),
        _fields: CAMPOS_CLIENTE_WOO,
      }),
      ctx.headers,
      "los clientes",
    );
    const { nuevos, fin } = clientesNuevosDePagina(items, hastaId);
    if (nuevos.length) {
      const { error: e } = await tabla(ctx.sb, "clientes").upsert(
        nuevos.map((c) => filaClienteRegistrado(c, ctx.tiendaId)),
        { onConflict: "tienda_id,woo_customer_id" },
      );
      if (e) throw new Error(`No se pudieron guardar los clientes: ${e.message}`);
      guardados += nuevos.length;
    }
    if (fin) return guardados;
  }
}

/** Correo → id de los clientes de TODA la empresa, leídos una vez por llamada. */
async function clientesPorEmail(ctx: ContextoSync): Promise<Map<string, string>> {
  if (ctx.clientePorEmail) return ctx.clientePorEmail;
  // En toda la empresa, no solo en esta tienda: el cliente es único, y quien
  // ya compró en otra tienda o encargó en el textil no es un cliente nuevo.
  // Todas las filas: Supabase corta en 1.000 sin avisar.
  const { data, error } = await leerTodas<{ id: string; email: string | null }>((desde, hasta) =>
    tabla(ctx.sb, "clientes")
      .select("id, email")
      .eq("empresa_id", ctx.empresaId)
      .not("email", "is", null)
      .order("id")
      .range(desde, hasta),
  );
  if (error) throw new Error(`No se pudieron leer los clientes: ${error.message}`);
  const mapa = new Map<string, string>();
  for (const c of data) if (c.email) mapa.set(c.email.trim().toLowerCase(), c.id);
  ctx.clientePorEmail = mapa;
  return mapa;
}

const ESTADO_WOO: Record<string, string> = {
  pending: "pendiente",
  processing: "en_produccion",
  "on-hold": "pendiente",
  completed: "entregado",
  cancelled: "cancelado",
  refunded: "cancelado",
  failed: "cancelado",
};

/**
 * Guarda una página de pedidos de WooCommerce: sus clientes, los pedidos, sus
 * líneas y sus devoluciones. Todo en un puñado de idas y vueltas a la base en
 * vez de varias por cada pedido.
 *
 * Si algo de esto falla, lanza: el cursor solo avanza cuando la página entera
 * se ha guardado, y así la próxima sincronización la repite en vez de dejar
 * un pedido sin líneas para siempre.
 */
async function guardarPedidosWoo(
  ctx: ContextoSync,
  orders: any[],
): Promise<{ ids: number[]; clientes: number; devoluciones: number }> {
  const resultado = { ids: [] as number[], clientes: 0, devoluciones: 0 };
  if (!orders.length) return resultado;

  // El cliente de cada pedido, en una sola consulta: antes era un SELECT por
  // pedido solo para encontrar su cliente_id.
  const idsClientesWoo = [
    ...new Set(orders.map((o) => Number(o.customer_id)).filter((id) => id > 0)),
  ];
  const clientePorWooId = new Map<number, string>();
  if (idsClientesWoo.length) {
    const { data: clis, error } = await tabla(ctx.sb, "clientes")
      .select("id, woo_customer_id")
      .eq("tienda_id", ctx.tiendaId)
      .in("woo_customer_id", idsClientesWoo);
    if (error) throw new Error(`No se pudieron leer los clientes de los pedidos: ${error.message}`);
    for (const c of clis ?? []) {
      if (c.woo_customer_id != null) clientePorWooId.set(Number(c.woo_customer_id), c.id);
    }

    // Clientes con cuenta que nunca llegaron aquí: la sincronización solo
    // traía 100 clientes, así que en una tienda con más había compradores sin
    // ficha y sus pedidos se quedaban sin cliente. Se piden los que faltan,
    // por id, y se guardan igual que el resto.
    const faltan = idsClientesWoo.filter((id) => !clientePorWooId.has(id));
    if (faltan.length) {
      try {
        const { items } = await paginaWoo(
          urlWoo(ctx.base, "customers", {
            include: faltan.join(","),
            per_page: String(POR_PAGINA_WOO),
            _fields: CAMPOS_CLIENTE_WOO,
          }),
          ctx.headers,
          "los clientes de los pedidos",
        );
        if (items.length) {
          const { data: nuevos, error: e } = await tabla(ctx.sb, "clientes")
            .upsert(
              items.map((c) => filaClienteRegistrado(c, ctx.tiendaId)),
              { onConflict: "tienda_id,woo_customer_id" },
            )
            .select("id, woo_customer_id");
          if (e) throw new Error(e.message);
          for (const c of nuevos ?? []) clientePorWooId.set(Number(c.woo_customer_id), c.id);
          resultado.clientes += nuevos?.length ?? 0;
        }
      } catch (e) {
        ctx.avisos.push(
          `Algún pedido se ha guardado sin enlazar con su cliente: ${(e as Error).message}`,
        );
      }
    }
  }

  // Los pedidos de invitado —sin customer_id— no salen en /customers, así
  // que sin esto nunca dejaban ficha en Clientes: se guardaban bien en el
  // pedido, pero el comprador desaparecía de la base de clientes en cuanto
  // se cerraba el pedido. Se identifican por correo, en minúsculas para no
  // duplicar a quien escribe su email distinto cada vez.
  const hayInvitados = orders.some((o) => !o.customer_id && o.billing?.email?.trim());
  const clientePorEmail = hayInvitados ? await clientesPorEmail(ctx) : new Map<string, string>();
  if (hayInvitados) {
    const nuevos = clientesInvitadosNuevos(orders, new Set(clientePorEmail.keys()));
    if (nuevos.length) {
      const { data: creados, error } = await tabla(ctx.sb, "clientes")
        .insert(nuevos.map((c) => ({ tienda_id: ctx.tiendaId, woo_customer_id: null, ...c })))
        .select("id, email");
      if (error) {
        ctx.avisos.push(`No se pudieron dar de alta los clientes de invitado: ${error.message}`);
      } else {
        for (const c of creados ?? []) {
          if (c.email) clientePorEmail.set(c.email.trim().toLowerCase(), c.id);
        }
        resultado.clientes += creados?.length ?? 0;
      }
    }
  }

  const filasPedidos = orders.map((o) => {
    // Los metros que mide el trabajo (montador), no la cantidad: ver
    // src/dominio/metros-woo.ts.
    const metros_total = metrosPedidoWoo(o.line_items, ctx.precioMetro);
    // Las direcciones del PEDIDO, no las de la ficha del cliente. Un pedido de
    // invitado no trae customer_id y se quedaba sin nombre ni correo: es el
    // «—» de la columna Cliente. Estos datos sí vienen siempre, dentro de
    // billing.
    const facturacion = direccionWoo(o.billing);
    const envio = direccionWoo(o.shipping);
    return {
      tienda_id: ctx.tiendaId,
      woo_order_id: o.id,
      // El número que ve el cliente, no el id interno de WordPress. En una
      // tienda sin plugins son el mismo; con un plugin de numeración, no, y
      // entonces el número del correo del cliente no coincidía con el de aquí.
      numero: numeroPedidoWoo(o) || String(o.id),
      // Sin esto se quedaba en 'manual', que es el valor por defecto de la
      // columna. No era cosmético: updatePedidoEstado y el aviso de tracking
      // comprueban origen === 'woocommerce' antes de devolver el cambio a la
      // web, así que nunca lo devolvían.
      origen: "woocommerce",
      estado: (ESTADO_WOO[o.status] ?? "pendiente") as any,
      cliente_id: o.customer_id
        ? (clientePorWooId.get(Number(o.customer_id)) ?? null)
        : (clientePorEmail.get(o.billing?.email?.trim().toLowerCase() ?? "") ?? null),
      cliente_nombre: facturacion?.nombre || null,
      cliente_email: facturacion?.email || null,
      cliente_telefono: facturacion?.telefono || null,
      direccion_facturacion: facturacion,
      // Woo manda `shipping` vacío cuando el envío es igual que la
      // facturación. Guardar un objeto de huecos sería peor que no guardar
      // nada: la pantalla lo enseñaría como una dirección.
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
  const res = await tabla(ctx.sb, "pedidos")
    .upsert(filasPedidos, { onConflict: "tienda_id,woo_order_id" })
    .select("id, woo_order_id, total");
  if (res.error) throw new Error(`No se pudieron guardar los pedidos: ${res.error.message}`);
  const pedidosGuardados = (res.data ?? []) as FilaPedidoGuardada[];
  if (!pedidosGuardados.length) return resultado;

  resultado.ids = pedidosGuardados.map((p) => Number(p.woo_order_id));
  const idPorWooId = new Map(pedidosGuardados.map((p) => [Number(p.woo_order_id), p.id]));
  const idsPedidos = pedidosGuardados.map((p) => p.id);

  // Las líneas de todos los pedidos de esta página, borradas y vueltas a
  // escribir de una vez en vez de un borrado y una escritura por pedido.
  const borrado = await tabla(ctx.sb, "pedido_items").delete().in("pedido_id", idsPedidos);
  if (borrado.error) {
    throw new Error(`No se pudieron rehacer las líneas de los pedidos: ${borrado.error.message}`);
  }
  const todasLasLineas = orders.flatMap((o) => {
    const pedido_id = idPorWooId.get(Number(o.id));
    if (!pedido_id) return [];
    return (o.line_items || []).map((li: any) => {
      const sub = Number(li.subtotal || 0);
      const ivaLi = Number(li.subtotal_tax || 0);
      // En metros si es un trabajo del montador (leídos o estimados); en
      // unidades si no.
      const { cantidad, unidad, precio_unitario, metros_origen, precio_metro_usado } =
        lineaPedidoWoo(li, ctx.precioMetro);
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
    let r = await tabla(ctx.sb, "pedido_items").insert(todasLasLineas);
    // Sin la migración 20261020100000 no existen las columnas del origen: se
    // guardan las líneas sin ellas.
    if (faltaLaColumna(r.error)) {
      const sinOrigen = todasLasLineas.map((linea) => {
        const copia: Record<string, unknown> = { ...linea };
        delete copia.metros_origen;
        delete copia.precio_metro_usado;
        return copia;
      });
      r = await tabla(ctx.sb, "pedido_items").insert(sinOrigen);
    }
    if (r.error) {
      throw new Error(`No se pudieron guardar las líneas de los pedidos: ${r.error.message}`);
    }
  }

  // --- Devoluciones ---------------------------------------------------------
  // WooCommerce ya trae los reembolsos de cada pedido dentro de la propia
  // respuesta de /orders (o.refunds), así que esto no hace ninguna llamada
  // extra a la tienda.
  const filasDevoluciones: any[] = [];
  const idsReembolsados: string[] = [];
  const idsParciales: string[] = [];
  for (const o of orders) {
    const pedido_id = idPorWooId.get(Number(o.id));
    if (!pedido_id) continue;
    const refunds = Array.isArray(o.refunds) ? o.refunds : [];
    if (!refunds.length) continue;
    for (const rf of refunds) {
      if (rf?.id == null) continue;
      filasDevoluciones.push({
        tienda_id: ctx.tiendaId,
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
    const { error } = await tabla(ctx.sb, "pedido_devoluciones").upsert(filasDevoluciones, {
      onConflict: "tienda_id,woo_refund_id",
    });
    if (error) throw new Error(`No se pudieron guardar las devoluciones: ${error.message}`);
  }
  for (const [estado_pago, ids] of [
    ["reembolsado", idsReembolsados],
    ["parcial", idsParciales],
  ] as const) {
    if (!ids.length) continue;
    const { error } = await tabla(ctx.sb, "pedidos").update({ estado_pago }).in("id", ids);
    if (error) throw new Error(`No se pudo marcar el pago de las devoluciones: ${error.message}`);
  }
  resultado.devoluciones = idsReembolsados.length + idsParciales.length;
  return resultado;
}

/**
 * Pedidos borrados en WooCommerce: se mira la ventana de los 100 más
 * recientes por fecha de creación, como siempre (ver src/dominio/sync-woo.ts).
 * Un pedido con una factura emitida no se borra nunca — la factura es
 * inmutable, pero el pedido que la originó desaparecería del CRM sin que
 * quedara ni rastro de a qué pedido corresponde.
 */
async function borrarPedidosDesaparecidos(
  ctx: ContextoSync,
): Promise<{ pedidos_borrados: number; protegidos_por_factura: number }> {
  const r = { pedidos_borrados: 0, protegidos_por_factura: 0 };
  // Solo id y fecha: aquí no se guarda nada de estos pedidos.
  const { items: ventana } = await paginaWoo(
    urlWoo(ctx.base, "orders", {
      per_page: String(POR_PAGINA_WOO),
      orderby: "date",
      order: "desc",
      _fields: "id,date_created",
    }),
    ctx.headers,
    "los últimos pedidos",
  );
  const desde = fechaMasAntigua(ventana);
  if (!desde) return r;

  const { data: candidatosCrm } = await tabla(ctx.sb, "pedidos")
    .select("id, woo_order_id")
    .eq("tienda_id", ctx.tiendaId)
    .eq("origen", "woocommerce")
    .not("woo_order_id", "is", null)
    .gte("fecha_pedido", desde);

  const desaparecidos = pedidosDesaparecidos(candidatosCrm ?? [], ventana);
  if (!desaparecidos.length) return r;

  const { data: facturados } = await tabla(ctx.sb, "facturas")
    .select("pedido_id")
    .in(
      "pedido_id",
      desaparecidos.map((p) => p.id),
    );
  const idsFacturados = new Set((facturados ?? []).map((f: any) => f.pedido_id));
  const aBorrar = desaparecidos.filter((p) => !idsFacturados.has(p.id));
  r.protegidos_por_factura = desaparecidos.length - aBorrar.length;

  if (aBorrar.length) {
    await tabla(ctx.sb, "pedidos")
      .delete()
      .in(
        "id",
        aBorrar.map((p) => p.id),
      );
    r.pedidos_borrados = aBorrar.length;
  }
  return r;
}

/** Lo que la pantalla devuelve para seguir donde lo dejó la tanda anterior. */
const esquemaCursorWoo = z.object({
  desde: z.string().datetime({ offset: true }).nullable(),
  pagina: z.number().int().min(1).max(PAGINA_MAXIMA_WOO),
});

/**
 * Sincronizar pedidos, clientes y productos desde WooCommerce.
 *
 * Trae TODO lo que ha cambiado desde la última sincronización, no solo los
 * últimos 100: pedidos nuevos o modificados, clientes nuevos y productos
 * modificados (ver src/dominio/cursor-woo.ts). Lo hace por tandas para no
 * pasarse del tiempo de una función: si queda algo, devuelve cuántos
 * (`quedan`) y por dónde seguir (`siguiente`), y la pantalla vuelve a llamar
 * con `continuar`. El cursor se guarda además en woo_sincronizacion después de
 * cada página, así que una sincronización cortada sigue después desde ahí.
 *
 * Las credenciales NUNCA viajan al navegador: se leen aquí en el servidor con
 * el cliente de servicio.
 */
export const sincronizarWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        /** Sin esto es una sincronización nueva; con esto, la tanda siguiente. */
        continuar: esquemaCursorWoo.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const inicio = Date.now();
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
    const empresaId = await empresaDeTienda(supabaseAdmin, data.tienda_id);

    const ctx: ContextoSync = {
      sb: supabaseAdmin,
      tiendaId: data.tienda_id,
      empresaId,
      // El precio por metro de Ajustes de Gerencia: con él se estiman los
      // metros de una línea del montador que no trae su longitud (ver
      // metros-woo.ts).
      precioMetro: await precioMetroDeEmpresa(supabaseAdmin, empresaId),
      base: tienda.woo_url.replace(/\/$/, ""),
      headers: { Authorization: autorizacionWoo(creds), Accept: "application/json" },
      clientePorEmail: null,
      avisos: [],
    };

    const guardado = await leerCursorGuardado(supabaseAdmin, data.tienda_id);
    let productos = 0;
    let clientes = 0;

    // Productos y clientes nuevos, solo en la primera tanda: las siguientes
    // son solo para los pedidos que quedan. Un fallo aquí no para los pedidos,
    // pero se avisa (antes se quedaba en la consola del servidor).
    if (!data.continuar) {
      try {
        const r = await sincronizarProductosWoo(ctx, guardado.productos_hasta);
        productos = r.guardados;
        if (r.hasta && r.hasta !== guardado.productos_hasta) {
          await guardarCursor(ctx, { productos_hasta: r.hasta });
        }
      } catch (e) {
        ctx.avisos.push(`Productos sin sincronizar: ${(e as Error).message}`);
      }
      try {
        clientes += await sincronizarClientesNuevosWoo(ctx);
      } catch (e) {
        ctx.avisos.push(`Clientes nuevos sin sincronizar: ${(e as Error).message}`);
      }
    }

    // --- Pedidos, por tandas ------------------------------------------------
    let cursor: CursorWoo = data.continuar
      ? { desde: fechaGmtWoo(data.continuar.desde), pagina: data.continuar.pagina }
      : { desde: guardado.pedidos_hasta ?? (await cursorDesdeLosPedidos(ctx)), pagina: 1 };
    const pedidosVistos = new Set<number>();
    let devoluciones = 0;
    let quedan: number | null = null;
    let fin = false;
    let detenida = false;
    let paginas = 0;

    for (;;) {
      const { items: orders, total } = await paginaWoo(
        urlWoo(ctx.base, "orders", parametrosPaginaWoo(cursor)),
        ctx.headers,
        "los pedidos",
      );
      if (filtroDeFechaIgnorado(cursor, orders)) throw new Error(VERSION_WOO_ANTIGUA);

      const g = await guardarPedidosWoo(ctx, orders);
      g.ids.forEach((id) => pedidosVistos.add(id));
      clientes += g.clientes;
      devoluciones += g.devoluciones;

      const avance = avanzarCursor(cursor, orders);
      quedan = quedanTrasPagina(total, cursor, orders.length, avance.fin);
      if (avance.siguiente.desde && avance.siguiente.desde !== cursor.desde) {
        await guardarCursor(ctx, { pedidos_hasta: avance.siguiente.desde });
      }
      cursor = avance.siguiente;
      paginas++;

      if (avance.fin) {
        fin = true;
        break;
      }
      if (cursor.pagina > PAGINA_MAXIMA_WOO) {
        // Miles de pedidos con el mismo segundo de modificación: no es normal.
        ctx.avisos.push(
          "WooCommerce tiene miles de pedidos modificados en el mismo segundo. La " +
            "sincronización se ha parado ahí para no dar vueltas sin fin; avisa para revisarlo.",
        );
        detenida = true;
        break;
      }
      if (!otraPaginaEnEstaTanda(paginas, Date.now() - inicio)) break;
    }

    // Los borrados en WooCommerce, solo al terminar: la ventana de los 100
    // últimos ya está al día.
    let borrados = { pedidos_borrados: 0, protegidos_por_factura: 0 };
    if (fin) {
      try {
        borrados = await borrarPedidosDesaparecidos(ctx);
      } catch (e) {
        console.error("Woo pedidos borrados error", e);
        ctx.avisos.push(`No se ha podido comprobar qué pedidos se han borrado en WooCommerce.`);
      }
    } else if (!detenida && !guardado.disponible) {
      ctx.avisos.push(
        "Falta la migración 20261024100000: si la sincronización se corta antes de " +
          "acabar, la siguiente vuelve a empezar desde el último pedido guardado.",
      );
    }

    return {
      ok: true,
      pedidos: pedidosVistos.size,
      clientes,
      productos,
      ...borrados,
      devoluciones_actualizadas: devoluciones,
      /** Pedidos que quedan por traer (aproximado); `null` si WooCommerce no lo dice. */
      quedan: fin ? 0 : quedan,
      /** Para la siguiente tanda; `null` si ya no queda nada. */
      siguiente: fin || detenida ? null : cursor,
      avisos: ctx.avisos,
    };
  });

/**
 * Rellenar Clientes con quien la sincronización normal se ha dejado fuera.
 *
 * `sincronizarWoo` trae los clientes que se dan de alta desde la última vez y
 * los de los pedidos que sincroniza. Hasta octubre de 2026 solo traía 100
 * clientes y 100 pedidos, así que en una tienda con más historial puede haber
 * compradores —con cuenta o de invitado— que nunca han llegado a tener ficha.
 * Este botón es aparte, para no volver más lenta la sincronización de cada
 * día: recorre TODO lo que tenga la tienda en WooCommerce, una vez, a demanda.
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
      `${base}/wp-json/wc/v3/customers?_fields=${CAMPOS_CLIENTE_WOO}`,
      headers,
    );
    let clientesRegistrados = 0;
    if (customers.length) {
      const filas = customers.map((c) => filaClienteRegistrado(c, data.tienda_id));
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
