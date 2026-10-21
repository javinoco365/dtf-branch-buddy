/**
 * Lo que leen las pestañas de Gerencia, montado a partir de lo leído.
 *
 * Antes vivía dentro de un `useMemo` de `routes/panel/gerencia.tsx`. Se saca
 * aquí, tal cual, para poder probarlo sin base de datos y para que cada
 * pestaña pueda pedir solo lo suyo sin que cambie ninguna cifra.
 *
 * Lógica pura: recibe filas ya leídas y devuelve los datos de las pestañas.
 */

import type { CobroConsolidado } from "./facturacion";
import type { CompraResumen, DocumentoDePedido } from "./fiscal";
import { gastosConCompras } from "./compras";
import type { Comparacion, Seleccion } from "./periodos";
import type { PedidoPendiente } from "./pendientes";
import {
  gastosDelGrupo,
  pedidosDocumentados,
  pendienteDocumentar,
  ventasDelGrupo,
  type Grupo,
  type PendienteDocumentar,
} from "./grupos";
import {
  AJUSTES_POR_DEFECTO,
  aplicarAjustesVentas,
  filtrarCobrosGerencia,
  filtrarPendientesGerencia,
  filtrarVentas,
  webSinPagar,
  type AjustesGerencia,
  type FiltroGerencia,
  type GastoFijo,
  type MovimientoBancoResumen,
  type Objetivo,
  type Venta,
} from "./gerencia";

type Rango = { desde: Date; hasta: Date };

/**
 * Todo lo que leen las pestañas, ya filtrado por tienda y canal. `TCaja` es
 * el apunte de caja tal como lo lee la aplicación (el dominio no lo mira).
 */
export type DatosGerencia<TCaja = unknown> = {
  /** Qué números se miran: total, documentados (A) o sin documento (B). */
  grupo: Grupo;
  /** Todas las ventas del periodo con los filtros y ajustes, de los dos grupos. */
  ventasTodas: Venta[];
  /** Los pedidos con factura o ticket vigente; nulo mientras se leen. */
  documentados: ReadonlySet<string> | null;
  /** Lo que falta por documentar en el periodo; nulo mientras se lee. */
  pendiente: PendienteDocumentar | null;
  filtro: FiltroGerencia;
  seleccion: Seleccion;
  rango: Rango;
  comparacion: Comparacion | null;
  costeMetro: number;
  tiendas: readonly { id: string; nombre: string }[];
  /**
   * Las del grupo elegido, ya sin los pedidos web sin pagar si en Ajustes se
   * ha dicho que no cuentan.
   */
  ventas: Venta[];
  ventasPrevias: Venta[];
  /** Los pedidos web sin pagar del periodo, cuenten o no. */
  webSinPagar: { pedidos: number; importe: number };
  ajustes: AjustesGerencia;
  /**
   * Todos los gastos de Ajustes, con y sin justificante, con sus facturas; y
   * las compras que cuestan como un gasto (origen «compra» y «amortizacion»).
   */
  gastos: GastoFijo[];
  /** Los del grupo elegido: A, con justificante; B, sin él; total, todos. */
  gastosDelGrupo: GastoFijo[];
  objetivos: Objetivo[];
  cobros: CobroConsolidado[];
  cobrosPrevios: CobroConsolidado[];
  /** Falso mientras se leen: «—» solo si de verdad no los hay (sin migración). */
  cobrosLeidos: boolean;
  cobrosDisponibles: boolean;
  pendientes: PedidoPendiente[];
  pendientesLeidos: boolean;
  pendientesDisponibles: boolean;
  caja: TCaja[] | undefined;
  banco: MovimientoBancoResumen[] | undefined;
  hoy: Date;
};

/** Una lectura que, si falla, no impide enseñar el resto. */
type LecturaTolerante<T> = { data: T | undefined; isError: boolean };

/** Lo que llega de las consultas, tal cual (`undefined` mientras se lee). */
export type EntradasGerencia<TCaja = unknown> = {
  grupo: Grupo;
  filtro: FiltroGerencia;
  seleccion: Seleccion;
  rango: Rango;
  comparacion: Comparacion | null;
  costeMetro: number;
  tiendas: readonly { id: string; nombre: string }[];
  hoy: Date;
  ventas: Venta[] | undefined;
  ventasPrevias: Venta[] | undefined;
  docs: readonly DocumentoDePedido[] | undefined;
  docsPrevios: readonly DocumentoDePedido[] | undefined;
  ajustes: LecturaTolerante<{
    ajustes: AjustesGerencia;
    gastos: GastoFijo[];
    objetivos: Objetivo[];
  }>;
  compras: LecturaTolerante<CompraResumen[]>;
  cobros: { disponible: boolean; cobros: CobroConsolidado[] } | undefined;
  cobrosPrevios: { disponible: boolean; cobros: CobroConsolidado[] } | undefined;
  pendientes: { disponible: boolean; pedidos: PedidoPendiente[] } | undefined;
  caja: { movimientos: TCaja[] } | undefined;
  banco: MovimientoBancoResumen[] | undefined;
};

const SIN_AJUSTES = { ajustes: AJUSTES_POR_DEFECTO, gastos: [], objetivos: [] };

/** Cada lectura de Gerencia que una pestaña puede pedir o no. */
export type FuenteGerencia =
  | "ventas"
  | "ventasPrevias"
  | "ajustes"
  | "compras"
  | "cobros"
  | "cobrosPrevios"
  | "pendientes"
  | "caja"
  | "banco"
  | "costeMetro";

export const FUENTES_GERENCIA: readonly FuenteGerencia[] = [
  "ventas",
  "ventasPrevias",
  "ajustes",
  "compras",
  "cobros",
  "cobrosPrevios",
  "pendientes",
  "caja",
  "banco",
  "costeMetro",
];

/**
 * Qué campo de DatosGerencia sale de qué lectura. Los de `null` no dependen
 * de ninguna (filtros, periodo, tiendas) o ya dicen ellos que faltan
 * (`documentados` y `pendiente` son nulos mientras no están).
 */
export const FUENTE_DEL_CAMPO: Record<keyof DatosGerencia, FuenteGerencia | null> = {
  grupo: null,
  filtro: null,
  seleccion: null,
  rango: null,
  comparacion: null,
  tiendas: null,
  hoy: null,
  documentados: null,
  pendiente: null,
  ventasTodas: "ventas",
  ventas: "ventas",
  webSinPagar: "ventas",
  ventasPrevias: "ventasPrevias",
  ajustes: "ajustes",
  objetivos: "ajustes",
  gastos: "compras",
  gastosDelGrupo: "compras",
  cobros: "cobros",
  cobrosLeidos: "cobros",
  cobrosDisponibles: "cobros",
  cobrosPrevios: "cobrosPrevios",
  pendientes: "pendientes",
  pendientesLeidos: "pendientes",
  pendientesDisponibles: "pendientes",
  caja: "caja",
  banco: "banco",
  costeMetro: "costeMetro",
};

export type PestanaGerencia =
  | "resumen"
  | "ventas"
  | "tesoreria"
  | "clientes"
  | "comercial"
  | "produccion"
  | "margen"
  | "resultados"
  | "fiscal"
  | "textil";

/**
 * Lo que lee cada pestaña de DatosGerencia (lo comprueba
 * arquitectura/gerencia-pestanas.test.ts contra el código de cada una). Las
 * pestañas cerradas no se montan: lo que no está aquí no se pide. Lo que cada
 * pestaña lee por su cuenta (fiscal, historial de clientes…) va aparte.
 */
export const FUENTES_DE_PESTANA: Record<PestanaGerencia, readonly FuenteGerencia[]> = {
  resumen: [
    "ventas",
    "ventasPrevias",
    "ajustes",
    "compras",
    "cobros",
    "cobrosPrevios",
    "pendientes",
    "banco",
    "costeMetro",
  ],
  ventas: ["ventas", "ajustes"],
  tesoreria: ["cobros", "cobrosPrevios", "pendientes", "caja", "banco"],
  clientes: ["ajustes"],
  comercial: [],
  produccion: ["ventas", "ajustes"],
  margen: ["ventas", "ventasPrevias", "ajustes", "compras", "costeMetro"],
  resultados: ["ventas", "ajustes", "compras", "costeMetro"],
  fiscal: [],
  textil: ["ventas", "ventasPrevias", "ajustes"],
};

export const esPestanaGerencia = (v: string): v is PestanaGerencia => v in FUENTES_DE_PESTANA;

/**
 * Los datos de las pestañas, o `null` mientras falte algo sin lo que las
 * cifras saldrían mal.
 *
 * Con `fuentes`, solo se espera a esas lecturas: los campos de las demás
 * salen vacíos y la pestaña no los lee. Sin `fuentes`, todas, como antes de
 * repartirlas por pestaña. Los campos de una lectura pedida son idénticos en
 * los dos casos (gerencia-datos.test.ts).
 */
export function montarDatosGerencia<TCaja>(
  e: EntradasGerencia<TCaja>,
  fuentes: readonly FuenteGerencia[] = FUENTES_GERENCIA,
): DatosGerencia<TCaja> | null {
  const { grupo, filtro, ventas, ventasPrevias, docs, docsPrevios, ajustes, compras } = e;
  const { cobros, cobrosPrevios, pendientes, caja, banco } = e;
  const pide = (f: FuenteGerencia) => fuentes.includes(f);
  // Si los ajustes no se pueden leer, Gerencia sigue con los de siempre.
  const aj = ajustes.data ?? (ajustes.isError ? SIN_AJUSTES : null);
  if (pide("ventas") && !ventas) return null;
  // Las ventas, las previas y los gastos se cuentan con los ajustes.
  const conAjustes = pide("ventas") || pide("ventasPrevias") || pide("ajustes") || pide("compras");
  if (conAjustes && !aj) return null;
  // Sin las compras, el beneficio saldría mejor de lo que es: se espera.
  if (pide("compras") && !compras.data && !compras.isError) return null;
  // Para separar A y B hacen falta los documentos; sin ellos, todavía no.
  if (grupo !== "total") {
    if (pide("ventas") && !docs) return null;
    if (pide("ventasPrevias") && e.comparacion && !docsPrevios) return null;
  }
  // Lo que la pestaña no pide y no ha llegado sale vacío: no lo lee.
  const { ajustes: a, gastos: gastosAjustes, objetivos } = aj ?? SIN_AJUSTES;
  const gastos = gastosConCompras(gastosAjustes, compras.data ?? []);
  const delPeriodo = filtrarVentas(ventas ?? [], filtro);
  const todas = aplicarAjustesVentas(delPeriodo, a);
  const documentados = pedidosDocumentados(docs ?? []);
  const documentadosPrevios = pedidosDocumentados(docsPrevios ?? []);
  return {
    grupo,
    ventasTodas: todas,
    documentados: docs ? documentados : null,
    pendiente: montarPendienteDocumentar(e),
    filtro,
    seleccion: e.seleccion,
    rango: e.rango,
    comparacion: e.comparacion,
    costeMetro: e.costeMetro,
    tiendas: e.tiendas,
    ventas: ventasDelGrupo(todas, documentados, grupo),
    ventasPrevias: ventasDelGrupo(
      aplicarAjustesVentas(filtrarVentas(ventasPrevias ?? [], filtro), a),
      documentadosPrevios,
      grupo,
    ),
    webSinPagar: webSinPagar(delPeriodo),
    ajustes: a,
    gastos,
    gastosDelGrupo: gastosDelGrupo(gastos, grupo),
    objetivos,
    cobros: filtrarCobrosGerencia(cobros?.cobros ?? [], filtro),
    cobrosPrevios: filtrarCobrosGerencia(cobrosPrevios?.cobros ?? [], filtro),
    cobrosLeidos: cobros !== undefined,
    cobrosDisponibles: cobros?.disponible ?? false,
    pendientes: filtrarPendientesGerencia(pendientes?.pedidos ?? [], filtro),
    pendientesLeidos: pendientes !== undefined,
    pendientesDisponibles: pendientes?.disponible ?? false,
    caja: caja?.movimientos,
    banco,
    hoy: e.hoy,
  };
}

/**
 * Lo que falta por documentar en el periodo (la insignia de la esquina), sin
 * esperar a nada más que a las ventas, los ajustes y los documentos. Nulo
 * mientras falte alguno: nunca un cero que no es.
 */
export function montarPendienteDocumentar(
  e: Pick<EntradasGerencia, "ventas" | "docs" | "ajustes" | "filtro">,
): PendienteDocumentar | null {
  const aj = e.ajustes.data ?? (e.ajustes.isError ? SIN_AJUSTES : null);
  if (!e.ventas || !aj || !e.docs) return null;
  const todas = aplicarAjustesVentas(filtrarVentas(e.ventas, e.filtro), aj.ajustes);
  return pendienteDocumentar(todas, pedidosDocumentados(e.docs));
}

/**
 * Los gastos de Ajustes con las compras que cuestan como un gasto, para el
 * Resumen diario; nulos mientras se leen.
 */
export function montarGastosGerencia(
  e: Pick<EntradasGerencia, "ajustes" | "compras">,
): GastoFijo[] | null {
  const aj = e.ajustes.data ?? (e.ajustes.isError ? SIN_AJUSTES : null);
  if (!aj || (!e.compras.data && !e.compras.isError)) return null;
  return gastosConCompras(aj.gastos, e.compras.data ?? []);
}
