/**
 * Reparto de una factura textil en el coste de entrada de sus artículos.
 *
 * Una factura de un proveedor textil trae artículos (una línea por talla),
 * pero también portes, descuentos y otros cargos. Lo que entra en el almacén
 * son los artículos, y cada unidad tiene que entrar a lo que de verdad costó:
 * su importe más la parte que le toca de todo lo demás. Así la suma de los
 * costes de entrada es la base de la factura **al céntimo** (invariante I1),
 * y el valor del almacén cuadra con las compras.
 *
 * Se hace en céntimos enteros con el método del mayor resto: nada de repartir
 * en coma flotante y «ajustar el último», que deja el descuadre siempre en la
 * misma línea y con el signo que toque.
 *
 * Los errores van sin texto (`ErrorEscaner`): el texto lo pone
 * `mensajeErrorEscaner` (src/lib/escaner-textil.ts) con src/lib/format.ts.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { redondear } from "./importes";
import type { ErrorEscaner, LineaRegistro, TipoLineaCompra } from "./tipos-textil";

/** Decimales del coste unitario de entrada (los de `coste_unitario_entrada` en la base). */
export const DECIMALES_COSTE_ENTRADA = 8;

/** Diferencia máxima, en céntimos, entre lo que suman las líneas y la base (redondeo del proveedor). */
const TOLERANCIA_BASE_CENTIMOS = 2;

export type LineaParaRepartir = {
  tipo: TipoLineaCompra;
  cantidad: number;
  unidades_por_pack: number;
  importe: number;
};

export type CosteEntrada = {
  /** Posición de la línea en el array original. */
  indice: number;
  unidades: number;
  importe: number;
  /** Lo que le toca de portes, descuentos, otros cargos y redondeo (con signo). */
  repartido: number;
  coste_total: number;
  coste_unitario: number;
};

export type ResultadoReparto =
  | {
      ok: true;
      entradas: CosteEntrada[];
      base: number;
      sumaLineas: number;
      aRepartir: number;
      criterio: "importe" | "unidades";
    }
  | { ok: false; errores: ErrorEscaner[] };

const centimos = (euros: number) => Math.round(redondear(Number.isFinite(euros) ? euros : 0) * 100);

/** Unidades que entran en el almacén: cantidad × unidades por pack, a 6 decimales. */
export function unidadesDeLinea(cantidad: number, unidadesPorPack: number): number {
  return redondear((Number(cantidad) || 0) * (Number(unidadesPorPack) || 0), 6);
}

/**
 * Reparte portes, descuentos, otros cargos y el redondeo entre los artículos.
 *
 * 1. Sin artículos → E-REG-8.
 * 2. Artículo con importe negativo → E-REG-9; unidades no enteras o ≤ 0 → E-REG-10.
 * 3. Las líneas tienen que sumar la base con ±2 céntimos → si no, E-REG-14.
 * 4. Lo que no es artículo (R = base − Σ artículos) se reparte por importe
 *    (o por unidades si los artículos son a 0 €) con el mayor resto.
 * 5. Un artículo que queda en negativo → E-REP-1.
 */
export function repartirCostes(
  lineas: readonly LineaParaRepartir[],
  base: number,
): ResultadoReparto {
  const articulos = lineas
    .map((l, indice) => ({ l, indice }))
    .filter(({ l }) => l.tipo === "articulo");
  if (articulos.length === 0) {
    return { ok: false, errores: [{ linea: null, codigo: "E-REG-8", datos: [] }] };
  }

  const errores: ErrorEscaner[] = [];
  const datos = articulos.map(({ l, indice }) => {
    const unidades = unidadesDeLinea(l.cantidad, l.unidades_por_pack);
    const c = centimos(l.importe);
    if (c < 0) errores.push({ linea: indice, codigo: "E-REG-9", datos: [] });
    if (!Number.isInteger(unidades) || unidades <= 0) {
      errores.push({
        linea: indice,
        codigo: "E-REG-10",
        datos: [l.cantidad, l.unidades_por_pack, unidades],
      });
    }
    return { indice, unidades, c, importe: c / 100 };
  });

  const baseC = centimos(base);
  const sumaC = lineas.reduce((a, l) => a + centimos(l.importe), 0);
  if (Math.abs(baseC - sumaC) > TOLERANCIA_BASE_CENTIMOS) {
    errores.push({ linea: null, codigo: "E-REG-14", datos: [sumaC / 100, baseC / 100] });
  }
  if (errores.length > 0) return { ok: false, errores };

  const sa = datos.reduce((a, d) => a + d.c, 0);
  const r = baseC - sa;
  const criterio = sa > 0 ? "importe" : "unidades";
  const pesos = datos.map((d) => (criterio === "importe" ? d.c : d.unidades));
  const w = pesos.reduce((a, p) => a + p, 0);
  const absR = Math.abs(r);
  const signo = r < 0 ? -1 : 1;

  // Mayor resto: la parte entera a cada uno y los céntimos que faltan, de uno
  // en uno, a los de mayor resto (empate: mayor peso, luego menor índice).
  const partes = pesos.map((p) => Math.floor((absR * p) / w));
  const restos = pesos.map((p) => (absR * p) % w);
  let faltan = absR - partes.reduce((a, p) => a + p, 0);
  const orden = datos
    .map((_, i) => i)
    .sort(
      (a, b) => restos[b] - restos[a] || pesos[b] - pesos[a] || datos[a].indice - datos[b].indice,
    );
  for (let k = 0; faltan > 0; k = (k + 1) % orden.length, faltan--) partes[orden[k]] += 1;

  const entradas: CosteEntrada[] = [];
  for (let i = 0; i < datos.length; i++) {
    const d = datos[i];
    const parte = signo * partes[i] || 0; // sin −0
    const totalC = d.c + parte;
    if (totalC < 0) {
      errores.push({ linea: d.indice, codigo: "E-REP-1", datos: [] });
      continue;
    }
    const coste_total = totalC / 100;
    entradas.push({
      indice: d.indice,
      unidades: d.unidades,
      importe: d.importe,
      repartido: parte / 100,
      coste_total,
      coste_unitario: redondear(coste_total / d.unidades, DECIMALES_COSTE_ENTRADA),
    });
  }
  if (errores.length > 0) return { ok: false, errores };

  return {
    ok: true,
    entradas,
    base: baseC / 100,
    sumaLineas: sumaC / 100,
    aRepartir: r / 100,
    criterio,
  };
}

/**
 * Aplica el reparto a las líneas de registro: rellena `unidades_stock`,
 * `coste_total_entrada` y `coste_unitario_entrada` en los artículos y los deja
 * en null en lo que no es artículo.
 */
export function conCostesDeEntrada(
  lineas: readonly LineaRegistro[],
  base: number,
): { ok: true; lineas: LineaRegistro[] } | { ok: false; errores: ErrorEscaner[] } {
  const r = repartirCostes(lineas, base);
  if (!r.ok) return r;
  const porIndice = new Map(r.entradas.map((e) => [e.indice, e]));
  return {
    ok: true,
    lineas: lineas.map((l, i) => {
      const e = porIndice.get(i);
      return {
        ...l,
        unidades_stock: e ? e.unidades : null,
        coste_total_entrada: e ? e.coste_total : null,
        coste_unitario_entrada: e ? e.coste_unitario : null,
      };
    }),
  };
}
