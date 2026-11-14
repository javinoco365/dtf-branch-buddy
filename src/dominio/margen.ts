/**
 * El margen en %: lo único que queda de Gerencia › Margen, cuyas cifras se
 * fueron a la Cuenta de resultados (cuenta.ts). Lo usan el stock textil y la
 * pestaña Textil.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";

/** Margen ÷ bruta, en %, con un decimal. Nulo sin ventas. */
export function porcentajeMargen(margen: number, bruta: number): number | null {
  return bruta > 0 ? redondear((margen / bruta) * 100, 1) : null;
}
