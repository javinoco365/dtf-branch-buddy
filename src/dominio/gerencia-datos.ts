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
  cobrosDisponibles: boolean;
  pendientes: PedidoPendiente[];
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

/**
 * Los datos de las pestañas, o `null` mientras falte algo sin lo que las
 * cifras saldrían mal.
 */
export function montarDatosGerencia<TCaja>(
  e: EntradasGerencia<TCaja>,
): DatosGerencia<TCaja> | null {
  const { grupo, filtro, ventas, ventasPrevias, docs, docsPrevios, ajustes, compras } = e;
  const { cobros, cobrosPrevios, pendientes, caja, banco } = e;
  // Si los ajustes no se pueden leer, Gerencia sigue con los de siempre.
  const aj = ajustes.data ?? (ajustes.isError ? SIN_AJUSTES : null);
  if (!ventas || !aj) return null;
  // Sin las compras, el beneficio saldría mejor de lo que es: se espera.
  if (!compras.data && !compras.isError) return null;
  const gastos = gastosConCompras(aj.gastos, compras.data ?? []);
  // Para separar A y B hacen falta los documentos; sin ellos, todavía no.
  if (grupo !== "total" && (!docs || (e.comparacion && !docsPrevios))) {
    return null;
  }
  const a = aj.ajustes;
  const delPeriodo = filtrarVentas(ventas, filtro);
  const todas = aplicarAjustesVentas(delPeriodo, a);
  const documentados = pedidosDocumentados(docs ?? []);
  const documentadosPrevios = pedidosDocumentados(docsPrevios ?? []);
  return {
    grupo,
    ventasTodas: todas,
    documentados: docs ? documentados : null,
    pendiente: docs ? pendienteDocumentar(todas, documentados) : null,
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
    objetivos: aj.objetivos,
    cobros: filtrarCobrosGerencia(cobros?.cobros ?? [], filtro),
    cobrosPrevios: filtrarCobrosGerencia(cobrosPrevios?.cobros ?? [], filtro),
    cobrosDisponibles: cobros?.disponible ?? false,
    pendientes: filtrarPendientesGerencia(pendientes?.pedidos ?? [], filtro),
    pendientesDisponibles: pendientes?.disponible ?? false,
    caja: caja?.movimientos,
    banco,
    hoy: e.hoy,
  };
}
