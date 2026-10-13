import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaTabla, tabla } from "./rpc";
import { FILAS_POR_PAGINA, leerTodas, trozos } from "./paginar";
import { leerPorIds, type ErrorConsulta } from "./leer-por-ids";
import { leerCredencialesWoo, autorizacionWoo } from "./woo-credenciales";
import { avisarPedidoEnviado, type ResultadoAviso } from "./correos.functions";
import { calcularLinea, calcularTotales } from "@/dominio/importes";
import { normalizarDireccion } from "@/dominio/direcciones";
import { documentoDelPedido, type DocumentoPedido } from "@/dominio/tickets";
import {
  ordenarPedidos,
  pedidoEnDias,
  tramoDeConsulta,
  type FechaPedido,
} from "@/dominio/dia-pedido";
import { referenciaFactura } from "@/lib/format";
import type { Cobro } from "./cobros.functions";

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

/** El ticket o la factura que cuenta para el pedido, para enseñarlo en la lista. */
export type DocumentoDeLista = {
  id: string;
  tipo: "ordinaria" | "simplificada";
  referencia: string;
};

/** Las filas de cada pedido, por su `pedido_id`, en el orden en que llegaron. */
function porPedido<T extends { pedido_id: string | null }>(filas: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const f of filas) {
    if (!f.pedido_id) continue;
    const suyas = mapa.get(f.pedido_id);
    if (suyas) suyas.push(f);
    else mapa.set(f.pedido_id, [f]);
  }
  return mapa;
}

/**
 * Las líneas de unos pedidos, en el orden en que se guardaron.
 *
 * `pedido_items` no tiene columna de orden, y paginar exige uno: ordenar por
 * id barajaría las líneas de cada pedido en pantalla y en el formulario. Así
 * que cada trozo se lee sin orden, como siempre, y solo si llega al tope de
 * filas de Supabase se vuelve a leer por páginas, ordenado por id: mejor las
 * líneas en otro orden que líneas de menos.
 */
async function lineasDePedidos(supabase: any, ids: readonly string[]) {
  const filas: any[] = [];
  // iva_rate viaja hasta la pantalla: sin él, el formulario de edición no
  // puede saber a qué tipo estaba una línea y la rellena con el 21 %. Una
  // línea al 10 % o al 4 % se convertía en una al 21 % con solo abrir el
  // pedido y guardarlo, sin avisar de nada.
  // select("*") y no la lista de columnas: metros_origen y precio_metro_usado
  // (20261020100000) pueden no existir todavía, y nombrarlas haría fallar la
  // consulta entera.
  const consulta = (trozo: string[]) =>
    supabase.from("pedido_items").select("*").in("pedido_id", trozo);
  for (const trozo of trozos([...new Set(ids)])) {
    const r = await consulta(trozo);
    if (r.error) return { data: filas, error: r.error as ErrorConsulta };
    if ((r.data ?? []).length < FILAS_POR_PAGINA) {
      filas.push(...(r.data ?? []));
      continue;
    }
    const todas = await leerTodas<any>((a, b) => consulta(trozo).order("id").range(a, b));
    filas.push(...todas.data);
    if (todas.error) return { data: filas, error: todas.error };
  }
  return { data: filas, error: null };
}

type DocumentoLeido = DocumentoPedido & {
  pedido_id: string;
  serie: string;
  ejercicio: number;
  numero: number;
  sustituye_a_id: string | null;
};

/**
 * El documento de cada pedido. Si no se puede leer, la lista sale igual, sin
 * documentos: no merece la pena dejar a nadie sin ver sus pedidos por esto.
 */
async function documentosDePedidos(
  supabase: unknown,
  ids: string[],
): Promise<Map<string, DocumentoDeLista>> {
  const resultado = new Map<string, DocumentoDeLista>();
  const { data: lista, error } = await leerPorIds<DocumentoLeido>(ids, (trozo, a, b) =>
    tabla(supabase, "facturas")
      .select(
        "id, pedido_id, tipo, serie, ejercicio, numero, estado, rectifica_a_id, sustituye_a_id",
      )
      .in("pedido_id", trozo)
      .neq("estado", "borrador")
      .order("id")
      .range(a, b),
  );
  if (error || !lista.length) return resultado;
  // Una rectificativa puede no llevar el pedido: se buscan por lo que corrigen.
  const { data: rect } = await leerPorIds<{ rectifica_a_id: string }>(
    lista.map((d) => d.id),
    (trozo, a, b) =>
      tabla(supabase, "facturas")
        .select("rectifica_a_id")
        .in("rectifica_a_id", trozo)
        .order("id")
        .range(a, b),
  );
  const rectificados = rect.map((r) => r.rectifica_a_id);
  for (const [pedidoId, suyos] of porPedido(lista)) {
    const d = documentoDelPedido(suyos, rectificados);
    if (d && d.tipo !== "rectificativa") {
      resultado.set(pedidoId, {
        id: d.id,
        tipo: d.tipo,
        referencia: referenciaFactura(d.serie, d.ejercicio, d.numero),
      });
    }
  }
  return resultado;
}

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
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // tabla() y select("*"): types.ts está generado y no conoce las columnas de
    // dirección, y nombrarlas en el select haría fallar la consulta entera
    // mientras la migración no esté aplicada. Ya pasó una vez con el menú de
    // tiendas: la lista se quedaba vacía sin decir por qué.
    //
    // Por días y no por instantes: un pedido web guarda su hora local como si
    // fuera UTC, y con el corte en hora de Madrid el de las 23:15 del último
    // día se quedaba fuera del periodo (y el de las 23:30 del día anterior,
    // dentro). Se pide un día más por cada lado y se filtra aquí por el día
    // del pedido, el mismo que lleva su ticket (ver dia-pedido.ts).
    //
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts), y
    // un trimestre o un año de pedidos pasa de ahí. Lo que cuelga de los
    // pedidos (líneas, clientes, envíos, cobros, documentos) se lee además por
    // trozos de ids, para que la lista no reviente la dirección de la petición.
    const tramo = tramoDeConsulta(data.desde, data.hasta);
    const { data: filas, error } = await leerTodas<FechaPedido & Record<string, any>>((a, b) => {
      let query = tabla(supabase, "pedidos")
        .select("*")
        .gte("fecha_pedido", tramo.desde)
        .lt("fecha_pedido", tramo.hasta);
      if (data.tiendaId) query = query.eq("tienda_id", data.tiendaId);
      return query.order("fecha_pedido", { ascending: false }).order("id").range(a, b);
    });
    if (error) throw new Error(error.message);
    // Una vez cada pedido: si entra uno nuevo mientras se leen las páginas, el
    // corte de la siguiente puede repetir una fila.
    const unicos = new Map(filas.map((p) => [p.id as string, p]));
    const pedidos = ordenarPedidos(
      [...unicos.values()].filter((p) => pedidoEnDias(p, data.desde, data.hasta)),
      "reciente",
    );
    if (pedidos.length === 0) return { pedidos: [], cobrosDisponibles: true };

    const ids = pedidos.map((p) => p.id as string);
    const tiendaIds = Array.from(new Set(pedidos.map((p) => p.tienda_id)));
    const clienteIds = pedidos.map((p) => p.cliente_id).filter(Boolean) as string[];

    const [
      { data: items },
      { data: tiendas },
      { data: clientes },
      { data: tracking },
      { data: cobros, error: errCobros },
      documentos,
    ] = await Promise.all([
      lineasDePedidos(supabase, ids),
      supabase.from("tiendas").select("id, nombre").in("id", tiendaIds),
      leerPorIds<any>(clienteIds, (trozo, a, b) =>
        supabase
          .from("clientes")
          .select("id, nombre, email")
          .in("id", trozo)
          .order("id")
          .range(a, b),
      ),
      leerPorIds<any>(ids, (trozo, a, b) =>
        supabase
          .from("enlaces_seguimiento")
          .select("id, pedido_id, transportista, url, codigo_seguimiento")
          .in("pedido_id", trozo)
          .order("id")
          .range(a, b),
      ),
      leerPorIds<Cobro>(ids, (trozo, a, b) =>
        tabla(supabase, "cobros")
          .select("*")
          .in("pedido_id", trozo)
          .order("fecha", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id")
          .range(a, b),
      ),
      documentosDePedidos(supabase, ids),
    ]);

    // Sin la migración de cobros, la lista sigue saliendo; solo sin cobros.
    const cobrosDisponibles = !faltaLaTabla(errCobros);
    if (errCobros && cobrosDisponibles) throw new Error(errCobros.message);

    const lineasDe = porPedido<any>(items);
    const seguimientoDe = porPedido<any>(tracking);
    const cobrosDe = porPedido(cobros);
    const fichas = new Map<string, any>(clientes.map((c) => [c.id, c]));
    const nombresTienda = new Map<string, string>(
      (tiendas ?? []).map((t: { id: string; nombre: string }) => [t.id, t.nombre]),
    );

    void userId;
    return {
      pedidos: pedidos.map((p) => {
        const cli = p.cliente_id ? fichas.get(p.cliente_id) : undefined;
        return {
          ...p,
          tienda_nombre: nombresTienda.get(p.tienda_id) ?? null,
          cliente_nombre: p.cliente_nombre ?? cli?.nombre ?? null,
          cliente_email: p.cliente_email ?? cli?.email ?? null,
          items: lineasDe.get(p.id) ?? [],
          tracking: seguimientoDe.get(p.id)?.[0] ?? null,
          cobros: cobrosDe.get(p.id) ?? [],
          documento: documentos.get(p.id) ?? null,
        };
      }),
      cobrosDisponibles,
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
