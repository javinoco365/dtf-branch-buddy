/**
 * Cálculo de bases, cuotas de IVA y totales.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos. Es la única implementación válida de estos
 * cálculos en todo el proyecto.
 *
 * Antes de este módulo había cuatro implementaciones distintas y ninguna
 * coincidía con las demás:
 *
 *   - `routes/panel/tiendas/$tiendaId/facturas.tsx` redondeaba cada línea al
 *     guardarla, pero calculaba los totales de cabecera sobre valores sin
 *     redondear. La suma de las líneas de una factura podía no cuadrar con su
 *     total.
 *   - `lib/textil.functions.ts` no redondeaba en ningún momento.
 *   - `components/textil/LineasEditor.tsx` y `components/PedidoFormDialog.tsx`
 *     calculaban a su manera para mostrar en pantalla, así que el usuario podía
 *     ver un total distinto del que se guardaba.
 *
 * ## Cómo se calcula, y por qué así
 *
 * La cuota de IVA se calcula **por tipo impositivo sobre la suma de las bases
 * de ese tipo**, no sumando las cuotas de cada línea. Es como lo espera la
 * Agencia Tributaria y es la forma del desglose que exige Verifactu. Sumar
 * cuotas redondeadas línea a línea produce descuadres de céntimos frente a la
 * cuota real del tipo, y esos céntimos aparecen luego en el modelo 303.
 *
 * El redondeo es a la mitad hacia arriba en valor absoluto (2,675 → 2,68), que
 * es el criterio de la facturación española. `toFixed` de JavaScript no sirve:
 * arrastra el error de la representación binaria y devuelve 2,67.
 */

/** Céntimos: los importes de factura se expresan siempre con dos decimales. */
export const DECIMALES_IMPORTE = 2;

/**
 * Redondea a la mitad hacia arriba en valor absoluto.
 *
 * Corrige antes el error de representación en coma flotante: `1.005 * 100`
 * vale 100.49999999999999 en binario, y redondearlo tal cual daría 1,00 en vez
 * de 1,01.
 */
export function redondear(valor: number, decimales: number = DECIMALES_IMPORTE): number {
  if (!Number.isFinite(valor)) return 0;
  const factor = 10 ** decimales;
  // toPrecision(12) descarta la basura binaria por debajo del céntimo
  // sin tocar ninguna cifra significativa de un importe real.
  const escalado = Number((valor * factor).toPrecision(12));
  const signo = escalado < 0 ? -1 : 1;
  return (signo * Math.round(Math.abs(escalado))) / factor;
}

/** Una línea tal y como la introduce el usuario, antes de calcular nada. */
export type LineaBruta = {
  cantidad: number;
  precio_unitario: number;
  /** Tipo impositivo en porcentaje: 21, 10, 4 o 0. */
  iva_rate: number;
  /** Descuento sobre la línea, en porcentaje. Opcional. */
  descuento_pct?: number;
};

/** Una línea con sus importes ya calculados y redondeados. */
export type LineaCalculada = {
  /** Base imponible de la línea, redondeada a céntimos. */
  base: number;
  /** Tipo impositivo aplicado. */
  iva_rate: number;
  /**
   * Cuota de IVA de la línea. Es informativa, para mostrarla en pantalla o
   * guardarla en `factura_items`. La cuota que va al desglose fiscal es la de
   * `Totales.desglose_iva`, calculada por tipo.
   */
  cuota: number;
  /** base + cuota. */
  total: number;
};

/** Una fila del desglose por tipo impositivo. */
export type DesgloseIva = {
  /** Tipo impositivo en porcentaje. */
  tipo: number;
  /** Suma de las bases imponibles de ese tipo. */
  base: number;
  /** Cuota del tipo, calculada sobre la base agregada. */
  cuota: number;
};

export type Totales = {
  /** Suma de las bases imponibles de todas las líneas. */
  base_imponible: number;
  /** Desglose por tipo impositivo, ordenado de mayor a menor tipo. */
  desglose_iva: DesgloseIva[];
  /** Suma de las cuotas del desglose. */
  iva_total: number;
  /** base_imponible + iva_total. */
  total: number;
};

export type OpcionesTotales = {
  /**
   * Gastos de envío, sin IVA. Se tratan como una línea más: entran en la base
   * imponible y tributan al tipo indicado.
   */
  envio?: number;
  /** Tipo impositivo de los gastos de envío. Por defecto, el general. */
  iva_envio?: number;
};

/** Tipo general del IVA en España. */
export const IVA_GENERAL = 21;

/**
 * Calcula los importes de una línea.
 *
 * La base se redondea a céntimos porque es un importe facturable por sí mismo:
 * se guarda en `factura_items.subtotal` y se imprime en el PDF.
 */
export function calcularLinea(linea: LineaBruta): LineaCalculada {
  const cantidad = Number(linea.cantidad) || 0;
  const precio = Number(linea.precio_unitario) || 0;
  const tipo = Number(linea.iva_rate) || 0;
  const descuento = Number(linea.descuento_pct) || 0;

  const bruto = cantidad * precio;
  const base = redondear(bruto * (1 - descuento / 100));
  const cuota = redondear(base * (tipo / 100));

  return { base, iva_rate: tipo, cuota, total: redondear(base + cuota) };
}

/**
 * Calcula los totales de un documento a partir de sus líneas.
 *
 * El desglose se agrupa por tipo impositivo y la cuota de cada tipo se calcula
 * sobre la base agregada de ese tipo, no sumando las cuotas de las líneas.
 */
export function calcularTotales(
  lineas: readonly LineaBruta[],
  opciones: OpcionesTotales = {},
): Totales {
  const calculadas = lineas.map(calcularLinea);

  const envio = redondear(Number(opciones.envio) || 0);
  const tipoEnvio = Number(opciones.iva_envio ?? IVA_GENERAL) || 0;

  // Bases acumuladas por tipo impositivo.
  const basesPorTipo = new Map<number, number>();
  for (const l of calculadas) {
    basesPorTipo.set(l.iva_rate, redondear((basesPorTipo.get(l.iva_rate) ?? 0) + l.base));
  }
  if (envio !== 0) {
    basesPorTipo.set(tipoEnvio, redondear((basesPorTipo.get(tipoEnvio) ?? 0) + envio));
  }

  const desglose_iva: DesgloseIva[] = Array.from(basesPorTipo.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([tipo, base]) => ({ tipo, base, cuota: redondear(base * (tipo / 100)) }));

  const base_imponible = redondear(desglose_iva.reduce((s, d) => s + d.base, 0));
  const iva_total = redondear(desglose_iva.reduce((s, d) => s + d.cuota, 0));

  return {
    base_imponible,
    desglose_iva,
    iva_total,
    total: redondear(base_imponible + iva_total),
  };
}

/**
 * Metros lineales de un conjunto de líneas.
 *
 * Solo cuentan las líneas medidas en metros: una línea de transporte o de
 * manipulado no suma metros impresos aunque tenga cantidad.
 */
export function calcularMetros(
  lineas: readonly { cantidad: number; unidad?: string | null }[],
): number {
  const total = lineas
    .filter((l) => (l.unidad ?? "m").toLowerCase() === "m")
    .reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  return redondear(total, 3);
}
