/**
 * Facturas de compra: qué se compra y cómo cuenta cada cosa en Gerencia.
 *
 * Toda factura de compra registrada tiene documento, así que es del grupo A:
 * su IVA entra en el 303 y su retención, en el 111. Lo que cambia según la
 * categoría es cómo cuesta en la cuenta de resultados:
 *
 *   - stock: el textil entra en el almacén y cuesta cuando se vende la
 *     prenda (coste de la ropa). Contarlo al comprar sería contarlo dos veces.
 *   - comparar: la tinta, el film y la mensajería ya cuestan por metro y por
 *     envío en cada pedido. Aquí solo se comparan con eso, para saber si el
 *     coste por metro está bien puesto.
 *   - amortizar: una máquina o un ordenador se gastan en años. Al resultado
 *     va cada año su parte (12 % las máquinas, 25 % la informática), como
 *     hará la gestoría en Sociedades. El IVA se deduce entero al comprar.
 *   - gasto: el resto cuesta entero el día de la factura.
 *
 * Una factura enlazada a un gasto fijo (el recibo del alquiler de marzo)
 * sustituye a la estimación de ese gasto en su periodo y no cuenta aparte.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { cargoDeFactura, sumarMeses, type GastoFijo } from "./gerencia";
import type { CompraResumen } from "./fiscal";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type TratoCompra = "stock" | "comparar" | "amortizar" | "gasto";

export type CategoriaCompra = {
  valor: string;
  etiqueta: string;
  trato: TratoCompra;
  /** Solo las que se amortizan: % al año. */
  amortizacion?: number;
};

export const CATEGORIAS_COMPRA: readonly CategoriaCompra[] = [
  { valor: "textil", etiqueta: "Textil (entra en el stock)", trato: "stock" },
  { valor: "consumibles", etiqueta: "Consumibles DTF (tinta, film, polvo)", trato: "comparar" },
  { valor: "envios", etiqueta: "Mensajería y envíos", trato: "comparar" },
  { valor: "maquinaria", etiqueta: "Maquinaria", trato: "amortizar", amortizacion: 12 },
  { valor: "informatica", etiqueta: "Equipos informáticos", trato: "amortizar", amortizacion: 25 },
  { valor: "publicidad", etiqueta: "Publicidad", trato: "gasto" },
  { valor: "material", etiqueta: "Material y oficina", trato: "gasto" },
  { valor: "reparaciones", etiqueta: "Reparaciones y mantenimiento", trato: "gasto" },
  { valor: "suministros", etiqueta: "Suministros", trato: "gasto" },
  { valor: "servicios", etiqueta: "Servicios profesionales", trato: "gasto" },
  { valor: "otros", etiqueta: "Otros", trato: "gasto" },
];

/** Sin categoría (antes de la migración), una compra es de textil. */
export function categoriaCompra(valor: string | null | undefined): CategoriaCompra {
  return CATEGORIAS_COMPRA.find((c) => c.valor === (valor ?? "textil")) ?? CATEGORIAS_COMPRA[0];
}

/** Cuántos meses dura la amortización a un % al año: 12 % → 100 meses. */
export function mesesDeAmortizacion(porcentaje: number): number {
  return Math.round(1200 / porcentaje);
}

const texto = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dia(t: string): Date {
  const [a, m, d] = t.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
}

/**
 * Los gastos de Ajustes con sus facturas, más las compras que cuestan como
 * un gasto: así todo Gerencia (beneficio, margen, resultados) las cuenta
 * igual que los gastos fijos.
 *
 * - Una compra registrada enlazada a un gasto, con un cargo en su fecha, va
 *   a las facturas de ese gasto.
 * - Si no, según su categoría: un gasto puntual el día de la factura (trato
 *   «gasto»), una cuota mensual durante los años de amortización
 *   («amortizar»), o nada («stock» y «comparar»).
 *
 * Las compras que salen de aquí no llevan IVA ni retención: esos van con la
 * compra al 303 y al 111, no dos veces.
 */
export function gastosConCompras(
  gastos: readonly GastoFijo[],
  compras: readonly CompraResumen[],
): GastoFijo[] {
  const porId = new Map(gastos.map((g) => [g.id, g]));
  const facturas = new Map<string, NonNullable<GastoFijo["facturas"]>[number][]>();
  const extra: GastoFijo[] = [];
  for (const c of compras) {
    if (c.estado !== "registrada" || !c.fecha || !c.id) continue;
    const gasto = c.gasto_id ? porId.get(c.gasto_id) : undefined;
    if (gasto && cargoDeFactura(gasto, c.fecha) !== null) {
      facturas.set(gasto.id, [
        ...(facturas.get(gasto.id) ?? []),
        { id: c.id, fecha: c.fecha, base: c.base, iva: c.iva, irpf: c.irpf ?? 0 },
      ]);
      continue;
    }
    const cat = categoriaCompra(c.categoria);
    const comun = {
      concepto: cat.etiqueta,
      tipo: "otros",
      iva_pct: 0,
      irpf_pct: 0,
      con_justificante: true,
      notas: null,
    };
    if (cat.trato === "gasto") {
      extra.push({
        ...comun,
        id: `compra:${c.id}`,
        origen: "compra",
        importe_mensual: num(c.base),
        periodicidad: "puntual",
        desde: c.fecha,
        hasta: null,
      });
    } else if (cat.trato === "amortizar" && cat.amortizacion) {
      const meses = mesesDeAmortizacion(cat.amortizacion);
      const fin = sumarMeses(dia(c.fecha), meses);
      fin.setDate(fin.getDate() - 1);
      extra.push({
        ...comun,
        id: `amortizacion:${c.id}`,
        origen: "amortizacion",
        importe_mensual: redondear(num(c.base) / meses, 4),
        periodicidad: "mensual",
        desde: c.fecha,
        hasta: texto(fin),
      });
    }
  }
  return [
    ...gastos.map((g) => (facturas.has(g.id) ? { ...g, facturas: facturas.get(g.id) } : g)),
    ...extra,
  ];
}

/** Lo que se ha comprado en el rango de lo que ya cuesta en cada pedido, sin IVA. */
export function comprasParaComparar(
  compras: readonly CompraResumen[],
  r: { desde: Date; hasta: Date },
): { consumibles: number; envios: number } {
  let consumibles = 0;
  let envios = 0;
  const desde = new Date(r.desde.getFullYear(), r.desde.getMonth(), r.desde.getDate());
  for (const c of compras) {
    if (c.estado !== "registrada" || !c.fecha) continue;
    const f = dia(c.fecha);
    if (f < desde || f > r.hasta) continue;
    if (c.categoria === "consumibles") consumibles += num(c.base);
    if (c.categoria === "envios") envios += num(c.base);
  }
  return { consumibles: redondear(consumibles), envios: redondear(envios) };
}

export type FilaComparada = {
  concepto: string;
  /** Lo que dicen las facturas de compra. */
  comprado: number;
  /** Lo que Gerencia cuenta en los pedidos. */
  estimado: number;
  /** Comprado − estimado: positivo, se compra más de lo que se cuenta. */
  diferencia: number;
};

/** Las compras de tinta y mensajería frente a lo que cuentan los pedidos. */
export function comparacionCompras(
  compradas: { consumibles: number; envios: number },
  estimado: { produccion: number; envios: number },
): FilaComparada[] {
  const fila = (concepto: string, comprado: number, est: number): FilaComparada => ({
    concepto,
    comprado,
    estimado: est,
    diferencia: redondear(comprado - est),
  });
  return [
    fila("Consumibles DTF", compradas.consumibles, estimado.produccion),
    fila("Mensajería", compradas.envios, estimado.envios),
  ];
}
