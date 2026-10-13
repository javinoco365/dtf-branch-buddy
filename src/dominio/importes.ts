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

// ---------------------------------------------------------------------------
// Documentos ya emitidos: se imprimen con lo congelado, sin recalcular
// ---------------------------------------------------------------------------

/**
 * Una línea de un documento ya emitido, como quedó en `factura_items` o en
 * `textil_factura_items`.
 */
export type LineaEmitida = LineaBruta & {
  /** Base imponible de la línea, congelada al emitir (la columna `subtotal`). */
  subtotal?: number | null;
};

/**
 * El importe sin IVA de una línea ya emitida: su base imponible.
 *
 * Es la base que se congeló al emitir, no cantidad × precio otra vez: si la
 * línea llevaba descuento, solo la base congelada lo recoge, y es la que sumó
 * el desglose del documento. Solo cuando una línea no la trae se calcula con
 * `calcularLinea`, que es la misma cuenta que hace la base al emitir
 * (`factura_calcular`).
 */
export function importeLineaSinIva(linea: LineaEmitida): number {
  const congelada = linea.subtotal;
  if (typeof congelada === "number" && Number.isFinite(congelada)) return congelada;
  return calcularLinea(linea).base;
}

/** Una cifra tal y como llega de la base: número, texto (numeric) o nada. */
type CifraGuardada = number | string | null | undefined;

/**
 * Una línea de un documento ya emitido, tal y como se guardó. En
 * `lineas_snapshot` y en `factura_items` van todas sus cifras; en
 * `textil_factura_items`, solo la base (`subtotal`): ni la cuota, ni el total,
 * ni la unidad.
 */
export type LineaGuardada = {
  descripcion?: string | null;
  cantidad?: CifraGuardada;
  unidad?: string | null;
  precio_unitario?: CifraGuardada;
  iva_rate?: CifraGuardada;
  subtotal?: CifraGuardada;
  iva?: CifraGuardada;
  total?: CifraGuardada;
};

/** Una línea lista para imprimir, con todas sus cifras. */
export type LineaImpresa = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  /** Base imponible. */
  subtotal: number;
  /** Cuota de IVA de la línea. */
  iva: number;
  total: number;
};

/** La unidad de una línea que no dice otra. Es la que pone `factura_calcular`. */
export const UNIDAD_POR_DEFECTO = "ud";

/** La cifra guardada como número, o nula si no hay ninguna. */
function cifra(v: CifraGuardada): number | null {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Las cifras de una línea ya emitida, para imprimirla.
 *
 * Lo congelado manda: la base, la cuota y el total que se guardaron al emitir
 * salen tal cual. Lo que la línea no guardó se calcula como lo calculó la base
 * al emitir (`factura_calcular`): la cuota, la base por el tipo redondeada a
 * céntimos; el total, base más cuota. Es lo que pasa con las líneas de
 * `textil_factura_items`, que solo guardan la base.
 */
export function lineaImpresa(linea: LineaGuardada): LineaImpresa {
  const cantidad = cifra(linea.cantidad) ?? 0;
  const precio_unitario = cifra(linea.precio_unitario) ?? 0;
  const iva_rate = cifra(linea.iva_rate) ?? 0;
  const subtotal = importeLineaSinIva({
    cantidad,
    precio_unitario,
    iva_rate,
    subtotal: cifra(linea.subtotal),
  });
  const iva = cifra(linea.iva) ?? redondear(subtotal * (iva_rate / 100));
  const total = cifra(linea.total) ?? redondear(subtotal + iva);
  return {
    descripcion: linea.descripcion ?? "",
    cantidad,
    unidad: linea.unidad?.trim() || UNIDAD_POR_DEFECTO,
    precio_unitario,
    iva_rate,
    subtotal,
    iva,
    total,
  };
}

/**
 * Las líneas de un documento ya emitido, para imprimirlo.
 *
 * Primero, las de `lineas_snapshot`: es lo que se congeló al emitir, con la
 * cuota, el total y la unidad de cada línea, y en el orden en que se
 * congelaron. Ese no es el orden en que se escribieron: `factura_calcular`
 * las ordena por descripción. Solo si el documento no lo tiene (los emitidos
 * antes del motor de facturación) salen de la tabla de líneas, completadas
 * con `lineaImpresa`.
 */
export function lineasImpresas(
  snapshot: unknown,
  lineas: readonly LineaGuardada[] | null | undefined,
): LineaImpresa[] {
  const congeladas = Array.isArray(snapshot)
    ? (snapshot.filter((l) => l !== null && typeof l === "object") as LineaGuardada[])
    : [];
  return (congeladas.length > 0 ? congeladas : (lineas ?? [])).map(lineaImpresa);
}

/** Una cuota de IVA del pie de un documento impreso. */
export type CuotaImpresa = {
  /**
   * Tipo impositivo de la cuota. Nulo cuando el documento no trae desglose y
   * la cuota es la de todo el documento.
   */
  tipo: number | null;
  cuota: number;
};

/** Las cifras del pie de un documento impreso. */
export type PieImporte = {
  base: number;
  /** Una cuota por tipo impositivo, en el orden del desglose congelado. */
  iva: CuotaImpresa[];
  total: number;
};

/**
 * Las cifras del pie de un documento ya emitido: base, IVA por tipo y total.
 *
 * Todas salen de lo congelado al emitir y ninguna se recalcula: ni la base se
 * suma de las líneas ni el total sale de base más IVA. Así lo impreso coincide
 * céntimo a céntimo con lo que hay en la base de datos y en el libro de IVA.
 *
 * El IVA va por tipo, como el desglose congelado, incluido un tipo del 0 %. Si
 * el documento no trae desglose (las facturas anteriores al motor de
 * facturación no lo tienen), sale una sola cuota, sin tipo: el IVA total.
 */
export function pieDocumentoEmitido(doc: {
  base_imponible: number;
  iva_total: number;
  total: number;
  desglose?: readonly DesgloseIva[] | null;
}): PieImporte {
  const desglose = doc.desglose ?? [];
  return {
    base: doc.base_imponible,
    iva:
      desglose.length > 0
        ? desglose.map((r) => ({ tipo: r.tipo, cuota: r.cuota }))
        : [{ tipo: null, cuota: doc.iva_total }],
    total: doc.total,
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
