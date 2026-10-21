/**
 * La lista de Pedidos: los pedidos de un periodo con sus líneas, cobros,
 * envío, cliente, tienda y documento.
 *
 * Recibe el cliente de Supabase del usuario (el de `context.supabase`): así
 * se aplica su RLS y este módulo no importa nada de servidor. La server
 * function `listPedidos` (pedidos.functions.ts) solo valida y llama aquí.
 */
import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import {
  enParalelo,
  FILAS_POR_PAGINA,
  juntarEnOrden,
  leerTodas,
  PETICIONES_A_LA_VEZ,
  trozos,
} from "./paginar";
import { leerPorIds, type ErrorConsulta } from "./leer-por-ids";
import { documentoDelPedido, type DocumentoPedido } from "@/dominio/tickets";
import {
  ordenarPedidos,
  pedidoEnDias,
  tramoDeConsulta,
  type FechaPedido,
} from "@/dominio/dia-pedido";
import { referenciaFactura } from "@/lib/format";
import { HORA_CORTE_POR_DEFECTO, horaCorta, metrosRealizadosPorDia } from "@/dominio/realizado";
import type { Cobro } from "./cobros.functions";

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
  // iva_rate viaja hasta la pantalla: sin él, el formulario de edición no
  // puede saber a qué tipo estaba una línea y la rellena con el 21 %. Una
  // línea al 10 % o al 4 % se convertía en una al 21 % con solo abrir el
  // pedido y guardarlo, sin avisar de nada.
  // select("*") y no la lista de columnas: metros_origen y precio_metro_usado
  // (20261020100000) pueden no existir todavía, y nombrarlas haría fallar la
  // consulta entera.
  const consulta = (trozo: string[]) =>
    supabase.from("pedido_items").select("*").in("pedido_id", trozo);
  // Los trozos se leen a la vez y se juntan en su orden: mismas líneas y en
  // el mismo orden que en serie, y el mismo «para en el primer error».
  const respuestas = await enParalelo(
    trozos([...new Set(ids)]),
    PETICIONES_A_LA_VEZ,
    async (trozo): Promise<{ data: any[]; error: ErrorConsulta | null }> => {
      const r = await consulta(trozo);
      if (r.error) return { data: [], error: r.error as ErrorConsulta };
      if ((r.data ?? []).length < FILAS_POR_PAGINA) return { data: r.data ?? [], error: null };
      return leerTodas<any>((a, b) => consulta(trozo).order("id").range(a, b));
    },
  );
  return juntarEnOrden(respuestas);
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

/** El periodo (días 'yyyy-mm-dd', los dos incluidos) y, si se quiere, una tienda. */
export type FiltroListaPedidos = { tiendaId?: string; desde: string; hasta: string };

export async function leerListaPedidosPorPartes(supabase: any, data: FiltroListaPedidos) {
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
  // La hora de corte y los metros realizados cada día del periodo, sean de
  // pedidos de ese día o de otros (un pedido de la tarde se hace al día
  // siguiente). Sin la migración de realizado_en, sin ellos. No dependen de
  // los pedidos: se piden a la vez que la primera página y se esperan
  // después, en el mismo orden de errores que antes.
  const extras = Promise.all([
    tabla(supabase, "gerencia_ajustes").select("*").limit(1).maybeSingle(),
    leerTodas<{ realizado_en: string | null; metros_total: number | null }>((a, b) => {
      let q = tabla(supabase, "pedidos")
        .select("realizado_en, metros_total")
        .gte("realizado_en", tramo.desde)
        .lt("realizado_en", tramo.hasta);
      if (data.tiendaId) q = q.eq("tienda_id", data.tiendaId);
      return q.order("realizado_en").order("id").range(a, b);
    }),
  ]);
  // Si los pedidos fallan se lanza su error sin esperar a estos: que su
  // rechazo, si lo hubiera, no quede como promesa sin atender.
  extras.catch(() => {});
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
  const [{ data: ajustes }, realizados] = await extras;
  const conRealizado = !faltaLaColumna(realizados.error);
  if (realizados.error && conRealizado) throw new Error(realizados.error.message);
  const horaCorte = horaCorta(
    (ajustes as { hora_corte?: string } | null)?.hora_corte,
    HORA_CORTE_POR_DEFECTO,
  );
  const realizadosPorDia = Object.fromEntries(metrosRealizadosPorDia(realizados.data));
  if (pedidos.length === 0) {
    return { pedidos: [], cobrosDisponibles: true, horaCorte, realizadosPorDia, conRealizado };
  }

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
      supabase.from("clientes").select("id, nombre, email").in("id", trozo).order("id").range(a, b),
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
    horaCorte,
    realizadosPorDia,
    conRealizado,
  };
}
