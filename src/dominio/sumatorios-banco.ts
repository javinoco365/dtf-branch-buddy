/**
 * Los totales del pie de las tablas de caja y banco que no caben en
 * `sumatorios.ts`.
 *
 * - Lo puesto por los socios en caja: la suma de su lista. NO es el total de
 *   gastos: los que paga la empresa no llevan socio y no están en la lista.
 * - Los enlaces de la conciliación: cada enlace junta uno o varios movimientos
 *   del banco con uno o varios documentos. Se suma el lado banco, movimiento a
 *   movimiento y sin repetir ninguno. El lado de los documentos no se suma:
 *   se pinta en valor absoluto y mezcla cobros con pagos.
 *
 * Lógica pura: sin base de datos, sin pantallas.
 */

import type { TotalSocio } from "./caja";
import { sumarImportes, totalesConSigno, type TotalesConSigno } from "./sumatorios";

export type TotalPuestoSocios = {
  /** Lo que han puesto de su bolsillo entre todos. */
  puesto: number;
  apuntes: number;
};

/** El total de la lista «Puesto por cada socio» de la caja. */
export function totalPuestoSocios(socios: readonly TotalSocio[]): TotalPuestoSocios {
  return {
    puesto: sumarImportes(socios, (s) => s.puesto),
    apuntes: socios.reduce((n, s) => n + s.apuntes, 0),
  };
}

export type TotalesEnlaces = TotalesConSigno & {
  enlaces: number;
  /** Movimientos distintos entre todos los enlaces. */
  movimientos: number;
  /**
   * De esos, los que no han llegado a la pantalla («Movimiento antiguo»): no
   * tienen importe que sumar, así que con alguno el total es parcial.
   */
  sinImporte: number;
  /** Banco − documentos, enlace a enlace: lo mismo que el «Difiere» de cada fila, sumado. */
  diferencia: number;
};

/**
 * El pie de una lista de enlaces de conciliación.
 *
 * Un movimiento se suma una vez aunque apareciera en dos enlaces: se suma lo
 * que ha pasado por el banco, no las filas. Entradas y salidas por separado,
 * porque en la misma lista hay cobros (abonos) y pagos (cargos).
 */
export function totalesEnlaces(
  enlaces: readonly { movimientos: readonly string[]; diferencia: number | string | null }[],
  movimientos: ReadonlyMap<string, { importe: number | string | null }>,
): TotalesEnlaces {
  const ids = [...new Set(enlaces.flatMap((e) => e.movimientos))];
  const cargados = ids.flatMap((id) => {
    const m = movimientos.get(id);
    return m ? [m] : [];
  });
  return {
    ...totalesConSigno(cargados, (m) => m.importe),
    enlaces: enlaces.length,
    movimientos: ids.length,
    sinImporte: ids.length - cargados.length,
    diferencia: sumarImportes(enlaces, (e) => e.diferencia),
  };
}
