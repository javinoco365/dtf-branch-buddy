import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, faltaLaFuncion, filasDeFuncion, llamarRpc, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { referenciaFactura } from "./format";
import {
  esperadoDe,
  planConciliacion,
  type Documento,
  type Movimiento,
  type TipoDocumento,
} from "@/dominio/motor-conciliacion";
import {
  agruparEnlaces,
  contarEnlaces,
  type EstadoEnlace,
  type FilaConciliacion,
} from "@/dominio/enlaces-conciliacion";
import { filasDePagina, paginaDeLista, ultimaPagina } from "@/dominio/paginacion";

/**
 * Conciliación con el motor: movimientos de todas las cuentas contra facturas
 * recibidas (cargos) y emitidas de tienda y de textil (abonos).
 *
 * Las reglas viven en `src/dominio/motor-conciliacion.ts`. Aquí se lee lo que
 * todavía se puede conciliar, se pasa el plan a la pantalla y se escribe solo
 * por las funciones de la base (banco_enlazar y compañía), que vuelven a
 * comprobarlo todo con las filas bloqueadas. Lo ya enlazado y los traspasos
 * se leen aparte, por páginas, para sus pestañas.
 *
 * Según lo que tenga la base:
 *   - Con 20261025100000: la ventana se lee de banco_*_por_conciliar (solo lo
 *     pendiente), el historial de banco_enlaces y los números de las pestañas
 *     de banco_conciliacion_cuantos, en una llamada.
 *   - Sin ella, pero con 20261017100000: el mismo motor, leyendo de las tablas
 *     como antes de esa migración (los más recientes de cada cosa, cobrados o
 *     no), y `falta` dice qué migración hace falta para mirar solo lo
 *     pendiente.
 *   - Sin 20261017100000: `disponible` es falso y la pantalla sigue con la
 *     conciliación de antes.
 */

/** La migración que hace falta para que la ventana mire solo lo pendiente. */
const MIGRACION = "20261025100000_conciliacion_pendientes.sql";
/** La que hace falta para el motor. */
const MIGRACION_MOTOR = "20261017100000_conciliacion_motor.sql";

export type DocumentoConciliable = Documento & {
  /** Para pintar: «Recibida», «Factura» o «Textil». */
  clase: string;
};

export type EnlaceGuardado = {
  grupo: string;
  estado: EstadoEnlace;
  motivo: string;
  diferencia: number;
  /** Con fecha, cuenta, concepto e importe: todo lo que pinta la fila. */
  movimientos: Movimiento[];
  documentos: DocumentoConciliable[];
};

/** Un traspaso entre cuentas propias, desde el lado que sale. */
export type TraspasoGuardado = { sale: Movimiento; entra: Movimiento | null };

/** Si quedaron movimientos o documentos fuera de la ventana de LIMITE_CONCILIACION. */
export type Recortado = { movimientos: boolean; documentos: boolean };

/** Cuántos hay en cada pestaña del historial, para su título. */
export type Cuantos = { revisar: number; conciliados: number; traspasos: number };

/**
 * La conciliación mira lo pendiente más reciente: los 2000 movimientos sin
 * conciliar más recientes y los 2000 documentos por conciliar más recientes de
 * cada clase (recibidas, facturas y textil). Es a propósito: el motor compara
 * cada movimiento libre con cada documento libre, y los movimientos entre sí
 * para los traspasos; sin tope, la pantalla tardaría cada vez más.
 *
 * Solo cuenta lo que todavía se puede conciliar: los tickets (nacen pagados),
 * lo ya enlazado y los traspasos no ocupan sitio. Antes sí, y en unos meses de
 * tickets una factura B2B sin cobrar se quedaba fuera. Se lee por páginas
 * hasta el límite (Supabase corta en 1000 sin avisar, ver paginar.ts) y, si
 * queda algo pendiente fuera, la pantalla lo dice (`recortado`).
 *
 * Sin 20261025100000 la ventana vuelve a ser la de antes: los 2000 más
 * recientes de cada cosa, estén pendientes o no.
 */
const LIMITE_CONCILIACION = 2000;

/** Enlaces o traspasos por página en las pestañas del historial. */
const POR_PAGINA_HISTORIAL = 100;

type Error_ = { code?: string; message: string } | null;
type Pagina<T> = { data: T[] | null; error: Error_ };
type PaginaContada<T> = Pagina<T> & { count: number | null };

type FilaMovimiento = {
  id: string;
  fecha: string;
  concepto: string | null;
  importe: number | string;
  cuenta_id: string | null;
};

type FilaDocumento = {
  tipo: TipoDocumento;
  id: string;
  fecha: string;
  /** Líquido de la recibida o total de la factura, sin signo. */
  importe: number | string | null;
  contraparte: string | null;
  nif: string | null;
  serie: string | null;
  ejercicio: number | null;
  numero: string | number | null;
};

type FilaEnlace = {
  grupo: string;
  estado: EstadoEnlace;
  motivo: string;
  diferencia: number | string;
  movimientos: FilaMovimiento[] | null;
  documentos: FilaDocumento[] | null;
};

/** Lo que el motor puede proponer, en la ventana. */
type Ventana = {
  movimientos: Movimiento[];
  documentos: DocumentoConciliable[];
  recortado: Recortado;
  /** Leída de las tablas: la migración que falta para mirar solo lo pendiente. */
  falta?: string;
  /** Leída de las tablas: los números de las pestañas, ya contados. */
  cuantos?: Cuantos;
};

const CLASE: Record<TipoDocumento, string> = {
  compra: "Recibida",
  factura: "Factura",
  textil: "Textil",
};

function movimientoDe(m: FilaMovimiento): Movimiento {
  return {
    id: m.id,
    fecha: m.fecha,
    concepto: m.concepto ?? "",
    importe: Number(m.importe),
    cuenta_id: m.cuenta_id,
  };
}

function referenciaDe(d: FilaDocumento): string | null {
  if (d.tipo === "factura") {
    return referenciaFactura(d.serie, d.ejercicio, d.numero == null ? null : Number(d.numero));
  }
  if (d.tipo === "textil") return `${d.serie ?? ""}${d.numero}`;
  return d.numero == null ? null : String(d.numero);
}

function documentoDe(d: FilaDocumento): DocumentoConciliable {
  return {
    tipo: d.tipo,
    id: d.id,
    fecha: d.fecha,
    esperado: esperadoDe(d.tipo, Number(d.importe ?? 0)),
    contraparte: d.contraparte,
    nif: d.nif,
    referencia: referenciaDe(d),
    clase: CLASE[d.tipo],
  };
}

const porFecha = (a: { fecha: string; id: string }, b: { fecha: string; id: string }) =>
  String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")) || a.id.localeCompare(b.id);

function enlaceDe(e: FilaEnlace): EnlaceGuardado {
  return {
    grupo: e.grupo,
    estado: e.estado,
    motivo: e.motivo,
    diferencia: Number(e.diferencia),
    movimientos: (e.movimientos ?? []).map(movimientoDe).sort(porFecha),
    documentos: (e.documentos ?? []).map(documentoDe).sort(porFecha),
  };
}

/**
 * Las filas de las tres tablas de documentos con la forma de
 * banco_documentos(), para leerlas sin esa función.
 */
type FilaCompra = {
  id: string;
  fecha: string;
  liquido: number | string | null;
  proveedor: string | null;
  nif_proveedor: string | null;
  numero: string | null;
};
type FilaFactura = {
  id: string;
  fecha: string;
  total: number | string;
  cliente_nombre: string | null;
  cliente_nif: string | null;
  serie: string | null;
  ejercicio: number | null;
  numero: number | null;
};
type FilaTextil = Omit<FilaFactura, "ejercicio" | "numero"> & { numero: string | null };

const COLUMNAS_COMPRA = "id, fecha, liquido, proveedor, nif_proveedor, numero";
const COLUMNAS_FACTURA = "id, fecha, total, cliente_nombre, cliente_nif, serie, ejercicio, numero";
const COLUMNAS_TEXTIL = "id, fecha, total, cliente_nombre, cliente_nif, serie, numero";

const deCompra = (c: FilaCompra): FilaDocumento => ({
  tipo: "compra",
  id: c.id,
  fecha: c.fecha,
  importe: c.liquido,
  contraparte: c.proveedor,
  nif: c.nif_proveedor,
  serie: null,
  ejercicio: null,
  numero: c.numero,
});
const deFactura = (f: FilaFactura): FilaDocumento => ({
  tipo: "factura",
  id: f.id,
  fecha: f.fecha,
  importe: f.total,
  contraparte: f.cliente_nombre,
  nif: f.cliente_nif,
  serie: f.serie,
  ejercicio: f.ejercicio,
  numero: f.numero,
});
const deTextil = (t: FilaTextil): FilaDocumento => ({
  tipo: "textil",
  id: t.id,
  fecha: t.fecha,
  importe: t.total,
  contraparte: t.cliente_nombre,
  nif: t.cliente_nif,
  serie: t.serie,
  ejercicio: null,
  numero: t.numero,
});

/**
 * Las LIMITE_CONCILIACION primeras filas de una consulta ordenada, por
 * páginas, y si había más. Pide una de más para saberlo.
 */
async function recientes<T>(consulta: (desde: number, hasta: number) => PromiseLike<Pagina<T>>) {
  const r = await leerTodas<T>((desde, hasta) =>
    consulta(desde, Math.min(hasta, LIMITE_CONCILIACION)),
  );
  return {
    data: r.data.slice(0, LIMITE_CONCILIACION),
    error: r.error,
    recortado: r.data.length > LIMITE_CONCILIACION,
  };
}

/** Lo que el motor puede proponer todavía, en la ventana. Nulo si falta 20261025100000. */
async function leerPendientes(supabase: unknown): Promise<Ventana | null> {
  const movs = await recientes<FilaMovimiento>((a, b) =>
    filasDeFuncion(supabase, "banco_movimientos_por_conciliar")
      .select("id, fecha, concepto, importe, cuenta_id")
      .order("fecha", { ascending: false })
      .order("id")
      .range(a, b),
  );
  if (faltaLaFuncion(movs.error)) return null;
  if (movs.error) throw new Error(movs.error.message);

  // Cada clase con su ventana, en el orden de siempre: recibidas, facturas y textil.
  const clases = await Promise.all(
    (["compra", "factura", "textil"] as const).map((tipo) =>
      recientes<FilaDocumento>((a, b) =>
        filasDeFuncion(supabase, "banco_documentos_por_conciliar")
          .select("tipo, id, fecha, importe, contraparte, nif, serie, ejercicio, numero")
          .eq("tipo", tipo)
          .order("fecha", { ascending: false })
          .order("id")
          .range(a, b),
      ),
    ),
  );
  for (const r of clases) if (r.error) throw new Error(r.error.message);

  return {
    movimientos: movs.data.map(movimientoDe),
    documentos: clases.flatMap((r) => r.data.map(documentoDe)),
    recortado: { movimientos: movs.recortado, documentos: clases.some((r) => r.recortado) },
  };
}

/** Cuántos traspasos hay, desde el lado que sale. */
async function contarTraspasos(supabase: unknown): Promise<number> {
  const r = await tabla(supabase, "banco_movimientos")
    .select("id", { count: "exact", head: true })
    .not("traspaso_con", "is", null)
    .lt("importe", 0);
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}

/**
 * Sin 20261025100000: la ventana de antes, leída de las tablas. Los 2000
 * movimientos más recientes y las 2000 facturas más recientes de cada clase,
 * cobradas o no; lo enlazado, los traspasos y las facturas de tienda en
 * 'pagada' se apartan después, aquí. Nulo si tampoco está 20261017100000.
 */
async function leerDeTablas(supabase: unknown): Promise<Ventana | null> {
  const movs = await recientes<FilaMovimiento & { traspaso_con: string | null }>((a, b) =>
    tabla(supabase, "banco_movimientos")
      .select("id, fecha, concepto, importe, cuenta_id, traspaso_con")
      .order("fecha", { ascending: false })
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(movs.error)) return null;
  if (movs.error) throw new Error(movs.error.message);

  // Todos los enlaces, no solo los de lo reciente: un documento de la ventana
  // pagado con un movimiento más antiguo tiene que salir como enlazado, o el
  // motor lo volvería a proponer.
  const enl = await leerTodas<{
    movimiento_id: string;
    factura_id: string | null;
    compra_id: string | null;
    textil_factura_id: string | null;
    estado: EstadoEnlace;
    grupo: string;
  }>((a, b) =>
    tabla(supabase, "banco_conciliaciones")
      .select("movimiento_id, factura_id, compra_id, textil_factura_id, estado, grupo")
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(enl.error)) return null;
  if (enl.error) throw new Error(enl.error.message);

  const [compras, facturas, textil] = await Promise.all([
    recientes<FilaCompra>((a, b) =>
      tabla(supabase, "textil_compras")
        .select(COLUMNAS_COMPRA)
        .eq("estado", "registrada")
        .is("borrada_en", null)
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    recientes<FilaFactura & { estado: string }>((a, b) =>
      tabla(supabase, "facturas")
        .select(`${COLUMNAS_FACTURA}, estado`)
        .in("estado", ["emitida", "vencida", "pagada"])
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    recientes<FilaTextil>((a, b) =>
      tabla(supabase, "textil_facturas")
        .select(COLUMNAS_TEXTIL)
        .not("estado", "in", "(borrador,anulada)")
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
  ]);
  for (const r of [compras, facturas, textil]) if (r.error) throw new Error(r.error.message);

  const movsEnlazados = new Set(enl.data.map((e) => e.movimiento_id));
  const docsEnlazados = new Set(
    enl.data.flatMap((e) => [e.factura_id, e.compra_id, e.textil_factura_id].filter(Boolean)),
  );
  const documentos = [
    ...compras.data.map(deCompra),
    // Las de tienda en 'pagada' ya están cobradas por otra vía.
    ...facturas.data.filter((f) => f.estado !== "pagada").map(deFactura),
    ...textil.data.map(deTextil),
  ]
    .filter((d) => !docsEnlazados.has(d.id))
    .map(documentoDe);

  return {
    movimientos: movs.data
      .filter((m) => !m.traspaso_con && !movsEnlazados.has(m.id))
      .map(movimientoDe),
    documentos,
    recortado: {
      movimientos: movs.recortado,
      documentos: [compras, facturas, textil].some((r) => r.recortado),
    },
    falta: MIGRACION,
    cuantos: { ...contarEnlaces(enl.data), traspasos: await contarTraspasos(supabase) },
  };
}

/** La ventana: solo lo pendiente si se puede; si no, la de antes. Nulo sin el motor. */
async function leer(supabase: unknown): Promise<Ventana | null> {
  return (await leerPendientes(supabase)) ?? (await leerDeTablas(supabase));
}

/** Cuántos enlaces por revisar, conciliados y traspasos hay, en una llamada y sin leerlos. */
async function contar(supabase: unknown): Promise<Cuantos> {
  const filas = await llamarRpc<
    { revisar: number | string; conciliados: number | string; traspasos: number | string }[]
  >(supabase, "banco_conciliacion_cuantos", {});
  const q = filas?.[0];
  return {
    revisar: Number(q?.revisar ?? 0),
    conciliados: Number(q?.conciliados ?? 0),
    traspasos: Number(q?.traspasos ?? 0),
  };
}

/**
 * Sin 20261025100000: todos los enlaces de la historia leídos de las tablas,
 * cada fila con su movimiento y su documento, y juntos por grupo como los
 * daría banco_enlaces(). Es más lento (se lee todo cada vez), pero solo hasta
 * que se aplique la migración.
 */
async function enlacesDeTablas(supabase: unknown) {
  type Fila = Omit<FilaConciliacion<FilaMovimiento, FilaDocumento>, "documento" | "diferencia"> & {
    diferencia: number | string;
    factura: FilaFactura | null;
    compra: FilaCompra | null;
    textil: FilaTextil | null;
  };
  const r = await leerTodas<Fila>((a, b) =>
    tabla(supabase, "banco_conciliaciones")
      .select(
        "grupo, estado, motivo, diferencia, " +
          "movimiento:movimiento_id(id, fecha, concepto, importe, cuenta_id), " +
          `factura:factura_id(${COLUMNAS_FACTURA}), ` +
          `compra:compra_id(${COLUMNAS_COMPRA}), ` +
          `textil:textil_factura_id(${COLUMNAS_TEXTIL})`,
      )
      .order("id")
      .range(a, b),
  );
  if (r.error) throw new Error(r.error.message);
  return agruparEnlaces(
    r.data.map((f) => ({
      grupo: f.grupo,
      estado: f.estado,
      motivo: f.motivo,
      diferencia: Number(f.diferencia),
      movimiento: f.movimiento,
      documento: f.compra
        ? deCompra(f.compra)
        : f.factura
          ? deFactura(f.factura)
          : f.textil
            ? deTextil(f.textil)
            : null,
    })),
  );
}

/**
 * Una página del historial, con el total. Si la pedida ya no existe (se ha
 * deshecho lo último de la última página), la última que queda: PostgREST
 * responde 416 (PGRST103) a una página más allá del final cuando se le pide
 * el total. Nulo si la función que se lee todavía no existe.
 */
async function leerPagina<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<PaginaContada<T>>,
  pedida: number,
) {
  const pedir = (pagina: number) => {
    const { desde, hasta } = filasDePagina(pagina, POR_PAGINA_HISTORIAL);
    return consulta(desde, hasta);
  };
  let pagina = pedida;
  let r = await pedir(pagina);
  if (faltaLaFuncion(r.error)) return null;
  const fuera =
    pagina > 0 && (r.error?.code === "PGRST103" || (!r.error && (r.data ?? []).length === 0));
  if (fuera) {
    const primera = await pedir(0);
    if (primera.error) throw new Error(primera.error.message);
    pagina = ultimaPagina(primera.count ?? 0, POR_PAGINA_HISTORIAL);
    r = pagina === 0 ? primera : await pedir(pagina);
  }
  if (r.error) throw new Error(r.error.message);
  return { filas: r.data ?? [], total: r.count ?? 0, pagina, porPagina: POR_PAGINA_HISTORIAL };
}

/** Movimientos y documentos por conciliar y el plan del motor. No escribe nada. */
export const verConciliacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const datos = await leer(context.supabase);
    if (!datos) return { disponible: false as const, falta: MIGRACION_MOTOR };
    return {
      disponible: true as const,
      movimientos: datos.movimientos,
      documentos: datos.documentos,
      plan: planConciliacion(datos.movimientos, datos.documentos),
      recortado: datos.recortado,
      limite: LIMITE_CONCILIACION,
      cuantos: datos.cuantos ?? (await contar(context.supabase)),
      falta: datos.falta,
    };
  });

/**
 * Una página de enlaces «por revisar» o conciliados, los de movimiento más
 * reciente primero, cada uno con sus movimientos y documentos completos.
 */
export const verEnlaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ estado: z.enum(["revisar", "conciliada"]), pagina: z.number().int().min(0) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const p = await leerPagina<FilaEnlace>(
      (a, b) =>
        filasDeFuncion(context.supabase, "banco_enlaces", { count: "exact" })
          .select("grupo, estado, motivo, diferencia, movimientos, documentos")
          .eq("estado", data.estado)
          .order("fecha", { ascending: false })
          .order("grupo")
          .range(a, b),
      data.pagina,
    );
    if (p) {
      return {
        enlaces: p.filas.map(enlaceDe),
        total: p.total,
        pagina: p.pagina,
        porPagina: p.porPagina,
      };
    }
    // Sin 20261025100000: de las tablas, y la página se corta aquí.
    const lista = (await enlacesDeTablas(context.supabase)).filter((e) => e.estado === data.estado);
    const pagina = paginaDeLista(lista, data.pagina, POR_PAGINA_HISTORIAL);
    return {
      enlaces: pagina.filas.map(enlaceDe),
      total: pagina.total,
      pagina: pagina.pagina,
      porPagina: POR_PAGINA_HISTORIAL,
    };
  });

/** Una página de traspasos entre cuentas propias, los más recientes primero. */
export const verTraspasos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ pagina: z.number().int().min(0) }).parse(d))
  .handler(async ({ data, context }) => {
    // Desde el lado que sale: cada pareja, una vez.
    const p = await leerPagina<FilaMovimiento & { traspaso_con: string }>(
      (a, b) =>
        tabla(context.supabase, "banco_movimientos")
          .select("id, fecha, concepto, importe, cuenta_id, traspaso_con", { count: "exact" })
          .not("traspaso_con", "is", null)
          .lt("importe", 0)
          .order("fecha", { ascending: false })
          .order("id")
          .range(a, b),
      data.pagina,
    );
    // Es una tabla, no una función: no puede faltar.
    if (!p) throw new Error("No se pudieron leer los traspasos.");
    const espejos = new Map<string, Movimiento>();
    const ids = p.filas.map((m) => m.traspaso_con);
    if (ids.length > 0) {
      const { data: filas, error } = await tabla(context.supabase, "banco_movimientos")
        .select("id, fecha, concepto, importe, cuenta_id")
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const m of (filas ?? []) as FilaMovimiento[]) espejos.set(m.id, movimientoDe(m));
    }
    return {
      traspasos: p.filas.map((m): TraspasoGuardado => ({
        sale: movimientoDe(m),
        entra: espejos.get(m.traspaso_con) ?? null,
      })),
      total: p.total,
      pagina: p.pagina,
      porPagina: p.porPagina,
    };
  });

/**
 * Aplica el plan: los verdes quedan conciliados, los ámbar en «revisar» (no
 * tocan nada hasta que alguien los confirma) y los traspasos marcados. El
 * plan se vuelve a calcular aquí con los datos de ahora, no se fía del que
 * vio la pantalla. Si uno falla (otra pestaña acaba de enlazarlo), se sigue
 * con los demás y se dice cuál.
 */
export const aplicarPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const datos = await leer(context.supabase);
    if (!datos) throw new Error(`Falta aplicar la migración ${MIGRACION_MOTOR}.`);
    const plan = planConciliacion(datos.movimientos, datos.documentos);
    const hechos = { verdes: 0, ambares: 0, traspasos: 0, errores: [] as string[] };
    for (const e of [...plan.verdes, ...plan.ambares]) {
      try {
        await llamarRpc(context.supabase, "banco_enlazar", {
          _movimientos: e.movimientos,
          _documentos: e.documentos,
          _estado: e.estado,
          _motivo: e.motivo,
        });
        if (e.estado === "conciliada") hechos.verdes++;
        else hechos.ambares++;
      } catch (err) {
        hechos.errores.push(err instanceof Error ? err.message : String(err));
      }
    }
    for (const t of plan.traspasos) {
      try {
        await llamarRpc(context.supabase, "banco_marcar_traspaso", { _a: t.a, _b: t.b });
        hechos.traspasos++;
      } catch (err) {
        hechos.errores.push(err instanceof Error ? err.message : String(err));
      }
    }
    return hechos;
  });

const documentoSchema = z.object({
  tipo: z.enum(["compra", "factura", "textil"]),
  id: z.string().uuid(),
});

/** Enlazar a mano: una persona lo ha mirado, así que queda conciliado. */
export const enlazarManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        movimientos: z.array(z.string().uuid()).min(1),
        documentos: z.array(documentoSchema).min(1),
      })
      .refine((x) => x.movimientos.length === 1 || x.documentos.length === 1, {
        message: "Varios movimientos contra varias facturas: hazlo por partes.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const grupo = await llamarRpc<string>(context.supabase, "banco_enlazar", {
      _movimientos: data.movimientos,
      _documentos: data.documentos,
      _estado: "conciliada",
      _motivo: "manual",
    });
    return { grupo };
  });

const grupoSchema = (d: unknown) => z.object({ grupo: z.string().uuid() }).parse(d);

export const confirmarEnlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(grupoSchema)
  .handler(async ({ data, context }) => ({
    ok: await llamarRpc<boolean>(context.supabase, "banco_confirmar", { _grupo: data.grupo }),
  }));

export const deshacerEnlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(grupoSchema)
  .handler(async ({ data, context }) => ({
    filas: await llamarRpc<number>(context.supabase, "banco_desenlazar", { _grupo: data.grupo }),
  }));

export const desmarcarTraspaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ movimiento_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => ({
    ok: await llamarRpc<boolean>(context.supabase, "banco_desmarcar_traspaso", {
      _movimiento_id: data.movimiento_id,
    }),
  }));
