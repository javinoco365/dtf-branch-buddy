/**
 * Proformas de proveedor: qué es cada documento, qué proformas esperan su
 * factura, cuál puede ser la de una factura y qué hará la base al casarlas.
 *
 * La proforma no es documento fiscal (no cuenta en el IVA ni en Gerencia),
 * pero la mercancía llega con ella: mete el stock al registrarse. Cuando
 * llega la factura, la persona elige con qué proforma casarla (nunca se casa
 * sola) y la base regulariza el stock talla a talla: si la factura trae más,
 * entra la diferencia; si trae menos, sale; si cuesta distinto, el stock que
 * queda se revaloriza con un `ajuste_coste`. `regularizacionPrevista` hace la
 * misma cuenta antes, para enseñarla: la base manda.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { claveNumero, claveProveedor } from "./cola-compras";
import { TOLERANCIA } from "./factura-compra";
import { redondear } from "./importes";
import { diasDesde } from "./pendientes";
import type { FilaRegularizacion, RegularizacionStock } from "./tipos-textil";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

/** Lo mínimo de una compra para saber qué documento es y con quién está casada. */
export type CompraConDocumento = {
  id: string;
  /** Sin la migración, undefined = factura. */
  tipo_documento?: string | null;
  proforma_id?: string | null;
  estado?: string | null;
  borrada_en?: string | null;
};

/** Una proforma (o cualquier compra) con lo que se enseña y se suma. */
export type ProformaFila = CompraConDocumento & {
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  numero: string | null;
  /** yyyy-MM-dd */
  fecha: string | null;
  categoria?: string | null;
  base: Numerico;
  total: Numerico;
  liquido?: Numerico;
  estado_pago?: string | null;
  fecha_pago?: string | null;
  fichero_ruta?: string | null;
  lineas?: readonly {
    tipo?: string | null;
    stock_id?: string | null;
    unidades_stock?: Numerico;
  }[];
};

export const esProforma = (c: { tipo_documento?: string | null }): boolean =>
  c.tipo_documento === "proforma";

/** Registrada (o sin estado: lo que da compras_proformas_pendientes()) y sin borrar. */
const viva = (c: CompraConDocumento) =>
  (c.estado === undefined || c.estado === null || c.estado === "registrada") && !c.borrada_en;

/** id de proforma → su factura casada (las facturas con proforma_id de la lista). */
export function facturasPorProforma<T extends CompraConDocumento>(
  compras: readonly T[],
): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const c of compras) {
    if (c.proforma_id && !esProforma(c) && !mapa.has(c.proforma_id)) mapa.set(c.proforma_id, c);
  }
  return mapa;
}

export type ProformaPendiente<T extends ProformaFila = ProformaFila> = {
  proforma: T;
  /** Días desde su fecha (diasDesde de pendientes.ts); null sin fecha. */
  dias: number | null;
  /** estado_pago === "pagada" */
  pagada: boolean;
  /** redondear(liquido ?? total) */
  importe: number;
};

const porFechaAsc = (a: ProformaFila, b: ProformaFila) => {
  if (a.fecha !== b.fecha) {
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return a.fecha < b.fecha ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Proformas registradas, sin borrar y sin factura casada en `compras` (las facturas de la
 * misma lista que apuntan a ellas). Desde el día 1, sin umbral. La más antigua primero
 * (fecha asc, id). Vale también con lo que devuelve compras_proformas_pendientes().
 */
export function proformasSinFactura<T extends ProformaFila>(
  compras: readonly T[],
  hoy: Date,
): ProformaPendiente<T>[] {
  const casadas = facturasPorProforma(compras);
  return compras
    .filter((c) => esProforma(c) && viva(c) && !casadas.has(c.id))
    .sort(porFechaAsc)
    .map((p) => ({
      proforma: p,
      dias: p.fecha ? diasDesde(p.fecha, hoy) : null,
      pagada: p.estado_pago === "pagada",
      importe: redondear(num(p.liquido ?? p.total)),
    }));
}

/**
 * Solo las proformas textiles (sin categoría cuenta como textil, como en la lista de compras):
 * lo que se enseña como cosa del almacén textil y lo que lista Textil › Compras.
 * compras_proformas_pendientes() da las de todas las categorías.
 */
export function proformasTextil<T extends { categoria?: string | null }>(filas: readonly T[]): T[] {
  return filas.filter((f) => (f.categoria ?? "textil") === "textil");
}

export type ResumenProformas = {
  proformas: number;
  /** Σ importe */
  importe: number;
  pagadas: number;
  /** Σ importe de las pagadas (anticipos) */
  importePagado: number;
  /** fecha */
  masAntigua: string | null;
  diasMasAntigua: number | null;
};

export function resumenProformas(pendientes: readonly ProformaPendiente[]): ResumenProformas {
  let importe = 0;
  let importePagado = 0;
  let pagadas = 0;
  let masAntigua: string | null = null;
  let diasMasAntigua: number | null = null;
  for (const p of pendientes) {
    importe += p.importe;
    if (p.pagada) {
      pagadas += 1;
      importePagado += p.importe;
    }
    const fecha = p.proforma.fecha;
    if (fecha && (masAntigua === null || fecha < masAntigua)) masAntigua = fecha;
    if (p.dias !== null && (diasMasAntigua === null || p.dias > diasMasAntigua))
      diasMasAntigua = p.dias;
  }
  return {
    proformas: pendientes.length,
    importe: redondear(importe),
    pagadas,
    importePagado: redondear(importePagado),
    masAntigua,
    diasMasAntigua,
  };
}

// ---------------------------------------------------------------------------
// Sugerir la proforma de una factura (nunca casa: propone)
// ---------------------------------------------------------------------------

/** El documento que se revisa, para sugerirle proformas. */
export type DocumentoParaCasar = {
  id?: string | null;
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  fecha: string | null;
  base: number;
  total: number;
  liquido?: number | null;
  categoria?: string | null;
  referencia_proforma?: string | null;
  /** Unidades por stock_id de sus artículos ya casados (textil); null si no se sabe. */
  unidades?: ReadonlyMap<string, number> | null;
};

export const PUNTOS_PROFORMA = {
  referencia: 50,
  total: 30,
  base: 20,
  unidades: 20,
  fecha: 10,
} as const;

export type SugerenciaProforma<T extends ProformaFila = ProformaFila> = {
  proforma: T;
  puntos: number;
  /** Por qué, en castellano y en orden: «Cita su número», «Mismo total», … */
  motivos: string[];
};

function mismoProveedor(d: DocumentoParaCasar, p: ProformaFila): boolean {
  if (d.proveedor_id && p.proveedor_id) return d.proveedor_id === p.proveedor_id;
  const clave = claveProveedor(d.nif_proveedor, d.proveedor);
  return clave !== "" && claveProveedor(p.nif_proveedor, p.proveedor) === clave;
}

/** Unidades por stock_id de las líneas artículo de la proforma; null sin líneas con variante. */
function unidadesDe(p: ProformaFila): Map<string, number> | null {
  if (!p.lineas) return null;
  const mapa = new Map<string, number>();
  for (const l of p.lineas) {
    if ((l.tipo ?? "articulo") !== "articulo" || !l.stock_id) continue;
    mapa.set(l.stock_id, (mapa.get(l.stock_id) ?? 0) + num(l.unidades_stock));
  }
  return mapa.size > 0 ? mapa : null;
}

function mismasUnidades(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const [k, v] of a) if (Math.abs((b.get(k) ?? Number.NaN) - v) > 1e-9) return false;
  return true;
}

/**
 * Proformas que pueden ser de este documento. NUNCA casa: propone.
 * Filtra: proforma registrada, sin borrar, sin factura (ni en `casadas` ni en la lista),
 * id ≠ documento, mismo proveedor (proveedor_id si los dos lo tienen; si no,
 * claveProveedor(nif, nombre) igual y no vacía), y (categoria === "textil") igual en los dos
 * cuando los dos la tienen.
 * Puntos: claveNumero(referencia_proforma) === claveNumero(numero) → referencia;
 * |total − total| ≤ TOLERANCIA (factura-compra.ts) → total (compara liquido si los dos lo tienen);
 * |base − base| ≤ TOLERANCIA → base; mapas de unidades por stock_id iguales (de las líneas
 * artículo de la proforma) → unidades; fecha proforma ≤ fecha documento → fecha.
 * Orden: puntos desc, fecha desc, id.
 */
export function sugerirProformas<T extends ProformaFila>(
  documento: DocumentoParaCasar,
  proformas: readonly T[],
  casadas: ReadonlySet<string>,
): SugerenciaProforma<T>[] {
  const enLista = facturasPorProforma(proformas);
  const referencia = claveNumero(documento.referencia_proforma);
  const sugerencias: SugerenciaProforma<T>[] = [];
  for (const p of proformas) {
    if (!esProforma(p) || !viva(p)) continue;
    if (casadas.has(p.id) || enLista.has(p.id)) continue;
    if (documento.id && p.id === documento.id) continue;
    if (!mismoProveedor(documento, p)) continue;
    if (
      documento.categoria &&
      p.categoria &&
      (documento.categoria === "textil") !== (p.categoria === "textil")
    )
      continue;

    let puntos = 0;
    const motivos: string[] = [];
    if (referencia !== "" && claveNumero(p.numero) === referencia) {
      puntos += PUNTOS_PROFORMA.referencia;
      motivos.push("Cita su número");
    }
    const conLiquido =
      documento.liquido !== undefined &&
      documento.liquido !== null &&
      p.liquido !== undefined &&
      p.liquido !== null &&
      p.liquido !== "";
    const totalDoc = conLiquido ? num(documento.liquido) : documento.total;
    const totalPro = conLiquido ? num(p.liquido) : num(p.total);
    if (Math.abs(redondear(totalDoc - totalPro)) <= TOLERANCIA) {
      puntos += PUNTOS_PROFORMA.total;
      motivos.push("Mismo total");
    }
    if (Math.abs(redondear(documento.base - num(p.base))) <= TOLERANCIA) {
      puntos += PUNTOS_PROFORMA.base;
      motivos.push("Misma base");
    }
    const unidadesPro = unidadesDe(p);
    if (documento.unidades && unidadesPro && mismasUnidades(documento.unidades, unidadesPro)) {
      puntos += PUNTOS_PROFORMA.unidades;
      motivos.push("Mismas unidades por talla");
    }
    if (p.fecha && documento.fecha && p.fecha.slice(0, 10) <= documento.fecha.slice(0, 10)) {
      puntos += PUNTOS_PROFORMA.fecha;
      motivos.push("Anterior a la factura");
    }
    sugerencias.push({ proforma: p, puntos, motivos });
  }
  return sugerencias.sort((a, b) => {
    if (a.puntos !== b.puntos) return b.puntos - a.puntos;
    const fa = a.proforma.fecha ?? "";
    const fb = b.proforma.fecha ?? "";
    if (fa !== fb) return fa < fb ? 1 : -1;
    return a.proforma.id < b.proforma.id ? -1 : a.proforma.id > b.proforma.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Regularización del stock (la misma cuenta que SQL 1.7, antes de registrar)
// ---------------------------------------------------------------------------

/** Una fila de proforma_entradas() (SQL 1.5). `devueltas`: uds devueltas a mano al proveedor
 *  enlazadas a la proforma; NO entran en la regularización (A2), solo se avisa.
 *  `posteriores`: uds que entraron en la variante de otros documentos después de la proforma
 *  (sin el dato, 0). */
export type EntradaProforma = {
  stock_id: string;
  unidades: number;
  valor: number;
  coste_unitario: number;
  devueltas: number;
  posteriores?: number;
};

/** Un artículo de la factura con su coste de entrada ya repartido (reparto-compra.ts). */
export type ArticuloFactura = {
  /** Posición en las líneas. */
  indice: number;
  /** null si es variante nueva o sin casar. */
  stock_id: string | null;
  /** unidades_stock */
  unidades: number;
  /** coste_total_entrada */
  coste_total: number;
};

export type StockActual = { cantidad: number; coste_unitario: number };

/** Coste medio tras una entrada, como el trigger: ponderado (o el de la entrada con saldo ≤ 0), a 4 decimales. */
function costeTrasEntrada(saldo: number, coste: number, cantidad: number, costeEntrada: number) {
  if (cantidad <= 0) return coste;
  if (saldo > 0)
    return redondear((saldo * coste + cantidad * costeEntrada) / (saldo + cantidad), 4);
  return redondear(costeEntrada, 4);
}

/**
 * La regularización que hará la base (SQL 1.7), calculada antes para enseñarla.
 * Mismas reglas, mismos redondeos: cP = valor/unidades (8 dec.), cF = Σcoste/Σunidades (8 dec.),
 * entran/salen, m = min(P, F), teorico = round(m×d, 2),
 * u = min(m, max(saldo0 − posteriores − salen, 0)) con
 * saldo0 = cantidad actual (ANTES de entran: lo que entra ya va al coste de la factura) y
 * posteriores = lo que entró de otros documentos después de la proforma (lo que queda en el
 * almacén es lo más nuevo: si la proforma ya se vendió, su diferencia no va al género de otra
 * compra; decisión 7),
 * importe = round(u×d, 2), tope de coste ≥ 0 con −floor(saldo × cm × 100)/100, donde
 * saldo = saldo0 + entran − salen y cm = coste medio tras la entrada, ponderado y a 4 decimales
 * como el trigger (si saldo0 ≤ 0, cm = cF), diferencia_sin_aplicar con el valor
 * de las devoluciones al coste medio de hoy.
 * Un artículo sin stock_id cuenta como variante propia con clave `nueva:<indice>` (stock 0).
 * Filas ordenadas por stock_id. `movimientos` = cuántos movimientos anotará.
 * Es una previsión: la base manda (el coste medio puede moverse entre medias).
 */
export function regularizacionPrevista(datos: {
  proforma: readonly EntradaProforma[];
  factura: readonly ArticuloFactura[];
  stock: ReadonlyMap<string, StockActual>;
  base_factura: number;
}): RegularizacionStock {
  const pro = new Map<string, { unidades: number; valor: number; posteriores: number }>();
  for (const e of datos.proforma) {
    const p = pro.get(e.stock_id) ?? { unidades: 0, valor: 0, posteriores: 0 };
    p.unidades += num(e.unidades);
    p.valor += num(e.valor);
    // Es un dato de la variante, no de cada entrada: no se suma.
    p.posteriores = Math.max(p.posteriores, num(e.posteriores));
    pro.set(e.stock_id, p);
  }
  const fac = new Map<string, { unidades: number; coste: number }>();
  for (const a of datos.factura) {
    const clave = a.stock_id ?? `nueva:${a.indice}`;
    const f = fac.get(clave) ?? { unidades: 0, coste: 0 };
    f.unidades += num(a.unidades);
    f.coste += num(a.coste_total);
    fac.set(clave, f);
  }

  const claves = [...new Set([...pro.keys(), ...fac.keys()])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const variantes: FilaRegularizacion[] = [];
  let entranT = 0;
  let salenT = 0;
  let valorProforma = 0;
  let valorEntradas = 0;
  let valorDevoluciones = 0;
  let importeAjustes = 0;
  let movimientos = 0;

  for (const v of claves) {
    const P = pro.get(v)?.unidades ?? 0;
    const valorP = pro.get(v)?.valor ?? 0;
    const posteriores = pro.get(v)?.posteriores ?? 0;
    const F = fac.get(v)?.unidades ?? 0;
    const valorF = fac.get(v)?.coste ?? 0;
    const cP = P !== 0 ? redondear(valorP / P, 8) : null;
    const cF = F !== 0 ? redondear(valorF / F, 8) : null;
    valorProforma += redondear(valorP);

    const actual = v.startsWith("nueva:") ? undefined : datos.stock.get(v);
    const saldo0 = actual ? num(actual.cantidad) : 0;
    const cm0 = actual ? num(actual.coste_unitario) : 0;

    // c1. Entran
    const entran = Math.max(F - P, 0);
    let cm = cm0;
    if (entran > 0 && cF !== null) {
      valorEntradas += redondear(entran * cF);
      cm = costeTrasEntrada(saldo0, cm0, entran, cF);
      movimientos += 1;
    }
    // c2. Salen, al coste medio vigente
    const salen = Math.max(P - F, 0);
    if (salen > 0) {
      valorDevoluciones += redondear(-salen * cm);
      movimientos += 1;
    }
    // c3. Coste distinto
    const m = Math.min(P, F);
    const d = cP !== null && cF !== null ? cF - cP : 0;
    const teorico = redondear(m * d);
    let u = 0;
    let importe = 0;
    if (teorico !== 0) {
      const saldo = saldo0 + entran - salen;
      u = Math.min(m, Math.max(saldo0 - posteriores - salen, 0));
      importe = redondear(u * d);
      if (saldo > 0 && saldo * cm + importe < 0) {
        importe = -Math.floor(redondear(saldo * cm * 100, 6)) / 100;
      }
      if (saldo > 0 && importe !== 0) {
        importeAjustes += importe;
        movimientos += 1;
      } else {
        importe = 0;
        u = 0;
      }
    }

    entranT += entran;
    salenT += salen;
    variantes.push({
      stock_id: v,
      unidades_proforma: P,
      unidades_factura: F,
      coste_unitario_proforma: cP,
      coste_unitario_factura: cF,
      entran,
      salen,
      unidades_ajustadas: u,
      importe_ajuste: importe,
      importe_sin_aplicar: redondear(teorico - importe),
    });
  }

  valorProforma = redondear(valorProforma);
  valorEntradas = redondear(valorEntradas);
  valorDevoluciones = redondear(valorDevoluciones);
  importeAjustes = redondear(importeAjustes);
  return {
    variantes,
    entran: entranT,
    salen: salenT,
    valor_proforma: valorProforma,
    valor_entradas: valorEntradas,
    valor_devoluciones: valorDevoluciones,
    importe_ajustes: importeAjustes,
    diferencia_sin_aplicar: redondear(
      datos.base_factura - (valorProforma + valorEntradas + valorDevoluciones + importeAjustes),
    ),
    movimientos,
  };
}

export type EstadoFilaRegularizacion =
  /** mismas unidades y mismo coste (|d| < 0,00005 €/ud o importe teórico 0) */
  | "igual"
  /** mismas unidades, otro coste */
  | "coste"
  /** la factura trae más (y quizá otro coste) */
  | "mas"
  /** la factura trae menos */
  | "menos"
  | "solo_factura"
  | "solo_proforma";

export function estadoFilaRegularizacion(f: FilaRegularizacion): EstadoFilaRegularizacion {
  if (f.unidades_proforma === 0) return "solo_factura";
  if (f.unidades_factura === 0) return "solo_proforma";
  if (f.unidades_factura > f.unidades_proforma) return "mas";
  if (f.unidades_factura < f.unidades_proforma) return "menos";
  const d = (f.coste_unitario_factura ?? 0) - (f.coste_unitario_proforma ?? 0);
  const teorico = redondear(f.importe_ajuste + f.importe_sin_aplicar);
  return Math.abs(d) < 0.00005 || teorico === 0 ? "igual" : "coste";
}

/**
 * Lo que pasará con el pago al casar (línea informativa de la revisión).
 * diferencia = redondear(liquidoFactura − (liquido ?? total) de la proforma);
 * revisarSiEnlazada = diferencia ≠ 0. La pantalla no sabe si el pago está enlazado en el banco
 * (la base pone el grupo en `revisar` solo si hay enlace, esté la proforma pagada o no): el texto
 * es condicional. La factura hereda «pagada» si el pago está enlazado o si el líquido es el mismo;
 * una proforma pagada a mano (sin enlace) con otro líquido deja la factura pendiente
 * (`pendienteSiAMano`), como hace la base, para que la diferencia no se pierda.
 */
export function pagoPrevisto(
  proforma: Pick<ProformaFila, "estado_pago" | "fecha_pago" | "liquido" | "total">,
  liquidoFactura: number,
): {
  pagada: boolean;
  fecha: string | null;
  diferencia: number;
  revisarSiEnlazada: boolean;
  pendienteSiAMano: boolean;
} {
  const diferencia = redondear(liquidoFactura - num(proforma.liquido ?? proforma.total));
  const pagada = proforma.estado_pago === "pagada";
  return {
    pagada,
    fecha: proforma.fecha_pago ?? null,
    diferencia,
    revisarSiEnlazada: diferencia !== 0,
    pendienteSiAMano: pagada && diferencia !== 0,
  };
}

/** Proformas con unidades ya devueltas a mano (A2): variantes con devueltas > 0. */
export function devueltasAntesDeFactura(
  entradas: readonly EntradaProforma[],
): { stock_id: string; devueltas: number }[] {
  return entradas
    .filter((e) => num(e.devueltas) > 0)
    .map((e) => ({ stock_id: e.stock_id, devueltas: num(e.devueltas) }));
}

/** Grupos de líneas partidas: las consecutivas con el mismo linea_papel (no nulo) van juntas. */
export function gruposPorLineaPapel(
  lineas: readonly { linea_papel?: number | null }[],
): { linea_papel: number | null; indices: number[] }[] {
  const grupos: { linea_papel: number | null; indices: number[] }[] = [];
  lineas.forEach((l, i) => {
    const n = l.linea_papel ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (n !== null && ultimo && ultimo.linea_papel === n) ultimo.indices.push(i);
    else grupos.push({ linea_papel: n, indices: [i] });
  });
  return grupos;
}

// ---------------------------------------------------------------------------
// Filtro de la lista de compras
// ---------------------------------------------------------------------------

export type FiltroDocumento =
  "todos" | "facturas" | "proformas_pendientes" | "proformas_facturadas";

export const FILTROS_DOCUMENTO: readonly { valor: FiltroDocumento; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Facturas y proformas" },
  { valor: "facturas", etiqueta: "Solo facturas" },
  { valor: "proformas_pendientes", etiqueta: "Proformas sin factura" },
  { valor: "proformas_facturadas", etiqueta: "Proformas facturadas" },
];

/** `casadas`: ids de las proformas que ya tienen factura. */
export function pasaFiltroDocumento(
  c: CompraConDocumento,
  filtro: FiltroDocumento,
  casadas: ReadonlySet<string>,
): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "facturas":
      return !esProforma(c);
    case "proformas_pendientes":
      return esProforma(c) && !casadas.has(c.id);
    case "proformas_facturadas":
      return esProforma(c) && casadas.has(c.id);
  }
}

/** Compras textil que movieron stock para enlazar una devolución a proveedor: proformas
 *  (con el n.º de su factura si la tienen) y facturas no casadas; nunca la factura casada. */
export function comprasParaDevolucion<T extends ProformaFila>(
  compras: readonly T[],
): { compra: T; facturadaEn: string | null }[] {
  const casadas = facturasPorProforma(compras);
  const salida: { compra: T; facturadaEn: string | null }[] = [];
  for (const c of compras) {
    if (!viva(c)) continue;
    if (c.categoria && c.categoria !== "textil") continue;
    if (esProforma(c)) {
      const f = casadas.get(c.id);
      salida.push({ compra: c, facturadaEn: f ? (f.numero ?? "(sin número)") : null });
    } else if (!c.proforma_id) {
      salida.push({ compra: c, facturadaEn: null });
    }
  }
  return salida;
}
