/**
 * Presupuestos de las tiendas: numeración, caducidad, importes y filtros.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos. El número lo
 * asigna la base (siguiente_numero, con la fila del contador bloqueada); aquí
 * solo se construye la referencia con el prefijo de la tienda.
 */

import {
  calcularLinea,
  calcularMetros,
  calcularTotales,
  importeLineaSinIva,
  IVA_GENERAL,
  redondear,
  UNIDAD_POR_DEFECTO,
} from "./importes";
import { normalizarTexto } from "./clientes";

export type EstadoPresupuesto = "borrador" | "enviado" | "aceptado" | "rechazado";

/** Lo que enseña la pantalla: además de los estados guardados, «caducado». */
export type EstadoVisiblePresupuesto = EstadoPresupuesto | "caducado";

export const ESTADOS_PRESUPUESTO: readonly { valor: EstadoPresupuesto; etiqueta: string }[] = [
  { valor: "borrador", etiqueta: "Borrador" },
  { valor: "enviado", etiqueta: "Enviado" },
  { valor: "aceptado", etiqueta: "Aceptado" },
  { valor: "rechazado", etiqueta: "Rechazado" },
];

export function etiquetaEstadoPresupuesto(e: EstadoVisiblePresupuesto): string {
  if (e === "caducado") return "Caducado";
  return ESTADOS_PRESUPUESTO.find((x) => x.valor === e)?.etiqueta ?? e;
}

// ---------------------------------------------------------------------------
// Numeración
// ---------------------------------------------------------------------------

/** El ámbito del contador de presupuestos de una tienda: uno por tienda. */
export function ambitoPresupuesto(tiendaId: string): string {
  return `presupuesto:${tiendaId}`;
}

/** PRES-DTFC-2026-0001. */
export function referenciaPresupuesto(prefijo: string, ejercicio: number, numero: number): string {
  return `PRES-${prefijo}-${ejercicio}-${String(numero).padStart(4, "0")}`;
}

/** Letras y números en mayúsculas, hasta 8: lo que admite la base. */
export function normalizarPrefijo(texto: string | null | undefined): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

export function prefijoValido(p: string | null | undefined): boolean {
  return !!p && /^[A-Z0-9]{1,8}$/.test(p);
}

/**
 * El prefijo que tiene la tienda, o el que se le deduce si no tiene: lo mismo
 * que hace la migración (cuatro primeras letras o números del slug o del
 * nombre; TDA si no queda nada).
 */
export function prefijoDeTienda(t: {
  prefijo?: string | null;
  slug?: string | null;
  nombre?: string | null;
}): string {
  if (prefijoValido(t.prefijo)) return t.prefijo!;
  const deducido = normalizarPrefijo(t.slug || t.nombre).slice(0, 4);
  return deducido || "TDA";
}

// ---------------------------------------------------------------------------
// Caducidad
// ---------------------------------------------------------------------------

/** El último día en que vale el presupuesto, `yyyy-MM-dd`. */
export function validoHasta(fecha: string, validezDias: number): string {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const fin = new Date(Date.UTC(a, m - 1, d + validezDias));
  return fin.toISOString().slice(0, 10);
}

/**
 * Un presupuesto en borrador o enviado cuyo plazo ya pasó se enseña como
 * caducado. No se guarda: es un hecho del calendario, no algo que haga nadie.
 * Aceptado y rechazado no caducan: ya tienen respuesta.
 */
export function estadoVisible(
  p: { estado: EstadoPresupuesto; fecha: string; validez_dias: number },
  hoy: Date,
): EstadoVisiblePresupuesto {
  if (p.estado !== "borrador" && p.estado !== "enviado") return p.estado;
  const hoyTexto = [
    hoy.getFullYear(),
    String(hoy.getMonth() + 1).padStart(2, "0"),
    String(hoy.getDate()).padStart(2, "0"),
  ].join("-");
  return validoHasta(p.fecha, p.validez_dias) < hoyTexto ? "caducado" : p.estado;
}

// ---------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------

export type LineaPresupuesto = {
  producto_id?: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
};

export type LineaPresupuestoCalculada = LineaPresupuesto & {
  subtotal: number;
  iva: number;
  total: number;
};

export type TotalesPresupuesto = {
  lineas: LineaPresupuestoCalculada[];
  /** Base imponible, envío incluido. */
  subtotal: number;
  iva: number;
  envio: number;
  total: number;
};

/**
 * Los importes de un presupuesto. El envío entra en la base imponible
 * (artículo 78 LIVA) y tributa al tipo general, salvo en un presupuesto sin
 * IVA (exportación, inversión del sujeto pasivo), donde tampoco lo lleva.
 */
export function totalesPresupuesto(
  lineas: readonly LineaPresupuesto[],
  envio: number,
): TotalesPresupuesto {
  const conIva = lineas.some((l) => Number(l.iva_rate) > 0);
  const t = calcularTotales(lineas, {
    envio: Number(envio) || 0,
    iva_envio: conIva ? IVA_GENERAL : 0,
  });
  return {
    lineas: lineas.map((l) => {
      const c = calcularLinea(l);
      return { ...l, subtotal: c.base, iva: c.cuota, total: c.total };
    }),
    subtotal: t.base_imponible,
    iva: t.iva_total,
    envio: redondear(Number(envio) || 0),
    total: t.total,
  };
}

// ---------------------------------------------------------------------------
// El documento que se imprime
// ---------------------------------------------------------------------------

/** Una cifra tal y como llega de la base: número o texto (numeric). */
type Cifra = number | string | null | undefined;

const cifra = (v: Cifra) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Una línea guardada en `presupuesto_items`. */
export type LineaPresupuestoImprimible = {
  orden?: number | null;
  descripcion: string;
  cantidad: Cifra;
  unidad?: string | null;
  precio_unitario: Cifra;
  iva_rate: Cifra;
  /** La base de la línea, guardada al guardar el presupuesto. */
  subtotal?: Cifra;
};

/** Una fila de la tabla del PDF. */
export type LineaDocumentoPresupuesto = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  /** Sin IVA: la base de la línea. La columna suma la base imponible. */
  importe: number;
};

export type DocumentoPresupuesto = {
  /** Las líneas en su orden y, si lo hay, el envío como una línea más al final. */
  lineas: LineaDocumentoPresupuesto[];
  /** Base imponible, envío incluido: la guardada. */
  base: number;
  /** Una fila por tipo de IVA. `tipo` nulo: no se sabe a qué tipo (ver abajo). */
  iva: { tipo: number | null; cuota: number }[];
  /** El total guardado: el mismo que enseña la lista. */
  total: number;
  /** Metros de las líneas en metros: lo que se imprime. */
  metros: number;
  /** Último día en que vale, `yyyy-MM-dd`. */
  validoHasta: string;
};

/** Cómo se llama el envío en el documento. */
export const DESCRIPCION_ENVIO = "Gastos de envío";

/**
 * Lo que dice el PDF de un presupuesto, sacado de lo guardado.
 *
 * Las cifras son las que se guardaron, no se recalculan: el total del PDF es
 * el de la lista. El envío va como una línea más porque forma parte de la base
 * imponible (artículo 78 LIVA): así la columna «Importe» suma exactamente la
 * base, y debajo van la base, el IVA de cada tipo y el total.
 *
 * El desglose por tipo se hace con las bases de las líneas, igual que lo hizo
 * `totalesPresupuesto` al guardar. Si no cuadra con lo guardado (un
 * presupuesto escrito por otro camino), no se inventa un reparto: sale una sola
 * fila con el IVA guardado, con su tipo si todas las líneas llevan el mismo.
 */
export function documentoPresupuesto(p: {
  fecha: string;
  validez_dias: number;
  envio: Cifra;
  subtotal: Cifra;
  iva: Cifra;
  total: Cifra;
  items: readonly LineaPresupuestoImprimible[];
}): DocumentoPresupuesto {
  const lineas: LineaDocumentoPresupuesto[] = [...p.items]
    .sort((a, b) => cifra(a.orden) - cifra(b.orden))
    .map((l) => {
      const cantidad = cifra(l.cantidad);
      const precio_unitario = cifra(l.precio_unitario);
      const iva_rate = cifra(l.iva_rate);
      const guardada = l.subtotal == null || l.subtotal === "" ? null : cifra(l.subtotal);
      return {
        descripcion: l.descripcion,
        cantidad,
        unidad: l.unidad?.trim() || UNIDAD_POR_DEFECTO,
        precio_unitario,
        iva_rate,
        importe: importeLineaSinIva({ cantidad, precio_unitario, iva_rate, subtotal: guardada }),
      };
    });

  const envio = redondear(cifra(p.envio));
  if (envio > 0) {
    // El mismo tipo que le puso totalesPresupuesto al guardar.
    const conIva = lineas.some((l) => l.iva_rate > 0);
    lineas.push({
      descripcion: DESCRIPCION_ENVIO,
      cantidad: 1,
      unidad: UNIDAD_POR_DEFECTO,
      precio_unitario: envio,
      iva_rate: conIva ? IVA_GENERAL : 0,
      importe: envio,
    });
  }

  const bases = new Map<number, number>();
  for (const l of lineas) {
    bases.set(l.iva_rate, redondear((bases.get(l.iva_rate) ?? 0) + l.importe));
  }
  const desglose = Array.from(bases.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([tipo, base]) => ({ tipo, base, cuota: redondear(base * (tipo / 100)) }));

  const base = redondear(cifra(p.subtotal));
  const ivaGuardado = redondear(cifra(p.iva));
  const cuadra =
    redondear(desglose.reduce((s, d) => s + d.base, 0)) === base &&
    redondear(desglose.reduce((s, d) => s + d.cuota, 0)) === ivaGuardado;

  return {
    lineas,
    base,
    iva: cuadra
      ? desglose.map((d) => ({ tipo: d.tipo, cuota: d.cuota }))
      : [{ tipo: desglose.length === 1 ? desglose[0].tipo : null, cuota: ivaGuardado }],
    total: redondear(cifra(p.total)),
    metros: calcularMetros(lineas),
    validoHasta: validoHasta(p.fecha, p.validez_dias),
  };
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export type FiltroPresupuestos = {
  texto: string;
  estado: EstadoVisiblePresupuesto | "todos";
};

export const FILTRO_PRESUPUESTOS_TODO: FiltroPresupuestos = { texto: "", estado: "todos" };

export function filtrarPresupuestos<
  T extends {
    numero: string;
    cliente_nombre: string | null;
    estado: EstadoPresupuesto;
    fecha: string;
    validez_dias: number;
  },
>(presupuestos: readonly T[], f: FiltroPresupuestos, hoy: Date): T[] {
  const q = normalizarTexto(f.texto);
  return presupuestos.filter(
    (p) =>
      (f.estado === "todos" || estadoVisible(p, hoy) === f.estado) &&
      (!q ||
        normalizarTexto(p.numero).includes(q) ||
        normalizarTexto(p.cliente_nombre).includes(q)),
  );
}
