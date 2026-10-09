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

import { IVA_GENERAL, redondear } from "./importes";
import { cargoDeFactura, sumarMeses, type GastoFijo } from "./gerencia";
import type { CompraResumen } from "./fiscal";
import type { LineaLeida } from "./factura-compra";

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

// ---------------------------------------------------------------------------
// Importes de una factura recibida
// ---------------------------------------------------------------------------

/**
 * Los importes de una factura recibida, igual que los calcula la base en sus
 * columnas generadas (20261014100000_compras_recibidas). Aquí solo sirven
 * para enseñarlos mientras se escribe: lo que se guarda lo calcula la base.
 * Los tipos van en tanto por uno (0,21).
 */
export function calcularCompra(c: { base: number; tipo_iva: number; tipo_irpf: number }): {
  cuotaIva: number;
  cuotaIrpf: number;
  total: number;
  liquido: number;
} {
  const base = redondear(c.base);
  const cuotaIva = redondear(base * c.tipo_iva);
  const cuotaIrpf = redondear(base * c.tipo_irpf);
  return {
    cuotaIva,
    cuotaIrpf,
    total: redondear(base + cuotaIva),
    liquido: redondear(base + cuotaIva - cuotaIrpf),
  };
}

/**
 * Lo que va del líquido impreso en la factura al calculado. Nulo si cuadran
 * al céntimo: cualquier diferencia hay que resolverla (eligiendo cuál vale).
 */
export function descuadreLiquido(calculado: number, impreso: number): number | null {
  const d = redondear(impreso - calculado);
  return Math.abs(d) >= 0.01 ? d : null;
}

/** El tipo con que empieza una factura escrita a mano: el general, en tanto por uno. */
export const TIPO_IVA_GENERAL = IVA_GENERAL / 100;

/** Los tipos de IVA de una factura recibida, en tanto por uno. */
export const TIPOS_IVA: readonly number[] = [TIPO_IVA_GENERAL, 0.1, 0.04, 0];
/** Las retenciones de IRPF habituales, en tanto por uno. */
export const TIPOS_IRPF: readonly number[] = [0.19, 0.15, 0.07, 0];

/**
 * El tipo habitual que explica una cuota leída de la factura: 21,00 € sobre
 * 100 € son el 21 %. Nulo si ninguno la explica (dos tipos en la misma
 * factura, o una lectura mala): entonces lo elige la persona.
 */
export function tipoProbable(
  base: number,
  cuota: number,
  tipos: readonly number[] = TIPOS_IVA,
): number | null {
  if (!(base > 0)) return cuota === 0 ? 0 : null;
  return tipos.find((t) => Math.abs(redondear(base * t) - Math.abs(cuota)) <= 0.02) ?? null;
}

export const tipoIrpfProbable = (base: number, cuota: number) =>
  tipoProbable(base, cuota, TIPOS_IRPF);

/**
 * El importe de una línea de compra: cantidad × coste unitario, al céntimo.
 * Es la misma cuenta que comprueba revisarCompra (factura-compra.ts).
 */
export function importeLineaCompra(l: { cantidad: Numerico; precio_unitario: Numerico }): number {
  return redondear(num(l.cantidad) * num(l.precio_unitario));
}

/**
 * Decimales del coste unitario que sale de dividir un importe: los mismos con
 * que normalizarCompra (factura-compra.ts) deduce el coste de una lectura.
 */
export const DECIMALES_COSTE_UNITARIO = 4;

/**
 * El coste unitario que explica el importe de una línea: importe / cantidad,
 * a cuatro decimales. Un importe con descuento (27 € por 3 unidades de 10 €)
 * da 9 €. Sin cantidad no se puede dividir: nulo.
 *
 * Con muchas unidades, cuatro decimales pueden no devolver el importe exacto
 * (1.234,56 € / 1.000 = 1,2346; × 1.000 = 1.234,60): revisarCompra lo avisa,
 * y la línea se queda con el importe escrito.
 */
export function costeUnitarioDeImporte(l: {
  cantidad: Numerico;
  importe: Numerico;
}): number | null {
  const cantidad = num(l.cantidad);
  if (cantidad === 0) return null;
  return redondear(num(l.importe) / cantidad, DECIMALES_COSTE_UNITARIO);
}

/**
 * Una línea después de que la corrija quien revisa la factura:
 *
 * - Si cambia el importe, se queda el escrito y el coste unitario se calcula
 *   otra vez (importe / cantidad). Así cabe el importe del papel aunque lleve
 *   descuento. Con cantidad 0 el coste se queda como estaba (revisarCompra ya
 *   avisa de la cantidad).
 * - Si cambia la cantidad o el coste unitario, el importe se calcula otra vez
 *   (cantidad × coste).
 * - Si solo cambia el concepto, se queda el importe que tenía (el leído del
 *   papel, aunque no cuadre: eso ya lo avisa revisarCompra).
 *
 * Si llegan a la vez el importe y el coste, se quedan los dos como vienen.
 */
export function cambiarLineaCompra<L extends LineaLeida>(linea: L, cambios: Partial<L>): L {
  const nueva = { ...linea, ...cambios };
  const cambiaImporte = "importe" in cambios;
  const cambiaCoste = "precio_unitario" in cambios;
  if (cambiaImporte && !cambiaCoste) {
    return { ...nueva, precio_unitario: costeUnitarioDeImporte(nueva) ?? nueva.precio_unitario };
  }
  if (cambiaImporte) return nueva;
  return "cantidad" in cambios || cambiaCoste
    ? { ...nueva, importe: importeLineaCompra(nueva) }
    : nueva;
}

/** Una línea en blanco para escribirla a mano: una unidad a 0 €. */
export function lineaCompraNueva(): LineaLeida {
  const linea = { descripcion: "", cantidad: 1, precio_unitario: 0, unidad: null };
  return { ...linea, importe: importeLineaCompra(linea) };
}

export const FORMAS_PAGO: readonly { valor: string; etiqueta: string }[] = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "domiciliacion", etiqueta: "Domiciliación" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "bizum", etiqueta: "Bizum" },
  { valor: "otro", etiqueta: "Otro" },
];

/**
 * Los importes que cuentan de una factura recibida, para el IVA, las
 * retenciones y el banco:
 *
 * - Con la migración de importes calculados, los de la base: cuota_iva,
 *   cuota_irpf y liquido. Si vale el importe impreso (liquido_origen
 *   «factura», por ejemplo una factura con dos tipos de IVA), las cuotas
 *   impresas.
 * - Sin ella, los que se guardaron (los impresos).
 *
 * Las borradas no cuentan: devuelve nulo.
 */
export function importesDeCompra<T extends CompraResumen>(c: T): T | null {
  if (c.borrada_en) return null;
  if (c.cuota_iva === undefined || c.cuota_iva === null) return c;
  const impresa = c.liquido_origen === "factura";
  return {
    ...c,
    iva: impresa ? c.iva : c.cuota_iva,
    irpf: impresa ? (c.irpf ?? 0) : (c.cuota_irpf ?? 0),
    total: c.liquido ?? c.total,
  };
}

/** Las facturas recibidas que cuentan, con sus importes buenos. */
export function comprasQueCuentan<T extends CompraResumen>(compras: readonly T[]): T[] {
  return compras.map(importesDeCompra).filter((c): c is T => c !== null);
}
