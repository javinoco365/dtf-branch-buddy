/**
 * Un presupuesto textil, tal como sale en su PDF.
 *
 * El PDF es el mismo que el de las tiendas (`generarPresupuestoPDF`, con la
 * plantilla del textil): aquí solo se traduce lo que guarda el textil a lo que
 * ese PDF entiende. Las cifras no se recalculan: la base, el IVA y el total
 * son los guardados por `upsertPresupuesto`, los mismos que enseña la lista.
 *
 * Lo que el textil guarda distinto de una tienda:
 *
 * - `textil_presupuesto_items` no tiene unidad ni orden. Lo que se presupuesta
 *   son prendas, así que la unidad es la de por defecto («ud»), salvo que la
 *   línea traiga una. El orden es el de alta (`created_at`); las líneas de un
 *   mismo guardado comparten instante y se quedan en el orden en que llegan.
 * - El IVA de la línea se llama `iva_pct`, no `iva_rate`.
 * - No hay envío.
 * - El cliente se congela entero en el presupuesto (nombre, correo, NIF y
 *   dirección como un texto); la ficha de `clientes`, si está enlazada,
 *   completa lo que falte.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 */

import {
  documentoPresupuesto,
  type DocumentoPresupuesto,
  type LineaPresupuestoImprimible,
} from "./presupuestos";
import { UNIDAD_POR_DEFECTO } from "./importes";
import { lineasDireccion } from "./direcciones";
import { normalizarTexto } from "./clientes";

/** Una cifra tal y como llega de la base: número o texto (numeric). */
type Cifra = number | string | null | undefined;

/** Un texto recortado; null si no queda nada. */
const limpio = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Las líneas y las cifras
// ---------------------------------------------------------------------------

/** Una línea guardada en `textil_presupuesto_items`. */
export type LineaPresupuestoTextilGuardada = {
  descripcion?: string | null;
  cantidad: Cifra;
  precio_unitario: Cifra;
  iva_pct: Cifra;
  /** La base de la línea, guardada al guardar el presupuesto. */
  subtotal?: Cifra;
  /** La tabla no la tiene hoy; si algún día la tiene, se respeta. */
  unidad?: string | null;
  created_at?: string | null;
};

/** Lo que hace falta de `textil_presupuestos` para sus cifras. */
export type PresupuestoTextilGuardado = {
  /** `yyyy-MM-dd`. */
  fecha: string;
  validez_dias: Cifra;
  subtotal: Cifra;
  iva: Cifra;
  total: Cifra;
  items?: readonly LineaPresupuestoTextilGuardada[] | null;
};

/** La validez de un presupuesto textil que no dice otra: la de la columna. */
export const VALIDEZ_TEXTIL_POR_DEFECTO = 30;

/** Los días de validez como número entero; los de por defecto si no hay. */
export function validezTextil(v: Cifra): number {
  const n = v == null || v === "" ? NaN : Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : VALIDEZ_TEXTIL_POR_DEFECTO;
}

/** El instante de alta de una línea; sin él, detrás de las que lo tienen. */
function alta(l: LineaPresupuestoTextilGuardada): number {
  const t = Date.parse(l.created_at ?? "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Las líneas del textil como las del PDF: en orden de alta, con su base
 * guardada, el tipo de IVA y la unidad.
 */
export function lineasPresupuestoTextil(
  items: readonly LineaPresupuestoTextilGuardada[] | null | undefined,
): LineaPresupuestoImprimible[] {
  return (items ?? [])
    .map((l, i) => ({ l, i, t: alta(l) }))
    .sort((a, b) => (a.t !== b.t ? (a.t < b.t ? -1 : 1) : a.i - b.i))
    .map(({ l }, orden) => ({
      orden,
      descripcion: (l.descripcion ?? "").trim(),
      cantidad: l.cantidad,
      unidad: limpio(l.unidad) ?? UNIDAD_POR_DEFECTO,
      precio_unitario: l.precio_unitario,
      iva_rate: l.iva_pct,
      subtotal: l.subtotal,
    }));
}

/**
 * Lo que dice el PDF de un presupuesto textil: sus líneas y las cifras
 * guardadas (base, IVA por tipo y total), sin envío.
 */
export function documentoPresupuestoTextil(p: PresupuestoTextilGuardado): DocumentoPresupuesto {
  return documentoPresupuesto({
    fecha: p.fecha,
    validez_dias: validezTextil(p.validez_dias),
    envio: 0,
    subtotal: p.subtotal,
    iva: p.iva,
    total: p.total,
    items: lineasPresupuestoTextil(p.items),
  });
}

/**
 * Un documento sin líneas, para la vista previa del editor cuando todavía no
 * hay ningún presupuesto textil: cero en todo, nada inventado.
 */
export function documentoPresupuestoTextilVacio(fecha: string): DocumentoPresupuesto {
  return documentoPresupuestoTextil({
    fecha,
    validez_dias: VALIDEZ_TEXTIL_POR_DEFECTO,
    subtotal: 0,
    iva: 0,
    total: 0,
    items: [],
  });
}

// ---------------------------------------------------------------------------
// El cliente
// ---------------------------------------------------------------------------

/** Lo que el presupuesto congeló del cliente al guardarse. */
export type ClienteCongeladoTextil = {
  cliente_nombre?: string | null;
  cliente_email?: string | null;
  cliente_nif?: string | null;
  /** Un texto libre: la calle que copió el selector o lo que se escribió. */
  cliente_direccion?: string | null;
};

/** La ficha del cliente en `clientes`, si el presupuesto la enlaza. */
export type FichaClienteTextil = {
  nombre?: string | null;
  empresa?: string | null;
  nif?: string | null;
  direccion?: string | null;
  codigo_postal?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  email?: string | null;
  telefono?: string | null;
};

/** El cliente tal como lo pide el PDF. */
export type ClientePresupuestoTextil = {
  nombre: string;
  empresa: string | null;
  nif: string | null;
  direccion: string[];
  email: string | null;
  telefono: string | null;
};

/**
 * El cliente del PDF: lo congelado en el presupuesto manda, porque es a quien
 * se le hizo; la ficha completa lo que el presupuesto no guarda (la empresa y
 * el teléfono) o dejó vacío.
 *
 * La dirección congelada es un texto libre, y al elegir un cliente el
 * formulario copia solo su calle. Si ese texto es justo la calle de la ficha,
 * se completa con el código postal, la ciudad, la provincia y el país de la
 * ficha; si es otro, se imprime tal cual, una línea por renglón.
 */
export function clientePresupuestoTextil(
  p: ClienteCongeladoTextil,
  ficha: FichaClienteTextil | null | undefined,
): ClientePresupuestoTextil {
  const f = ficha ?? {};
  const resto = {
    codigo_postal: limpio(f.codigo_postal),
    ciudad: limpio(f.ciudad),
    provincia: limpio(f.provincia),
    pais: limpio(f.pais),
  };

  const congelada = (p.cliente_direccion ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const calleFicha = limpio(f.direccion);
  let direccion: string[];
  if (congelada.length === 0) {
    direccion = lineasDireccion({ direccion: calleFicha, ...resto });
  } else if (
    calleFicha &&
    congelada.length === 1 &&
    normalizarTexto(congelada[0]).replace(/\s+/g, " ") ===
      normalizarTexto(calleFicha).replace(/\s+/g, " ")
  ) {
    direccion = lineasDireccion({ direccion: congelada[0], ...resto });
  } else {
    direccion = congelada;
  }

  return {
    nombre: limpio(p.cliente_nombre) ?? limpio(f.nombre) ?? "",
    empresa: limpio(f.empresa),
    nif: limpio(p.cliente_nif) ?? limpio(f.nif),
    direccion,
    email: limpio(p.cliente_email) ?? limpio(f.email),
    telefono: limpio(f.telefono),
  };
}

// ---------------------------------------------------------------------------
// La marca: identidad y contacto
// ---------------------------------------------------------------------------

/** Lo que se usa de una fila de `textil_marcas`. */
export type MarcaTextil = {
  nombre?: string | null;
  logo_url?: string | null;
  color?: string | null;
  email?: string | null;
  telefono?: string | null;
};

/**
 * El nombre comercial, el logo y el color de la marca: la base sobre la que
 * la plantilla del textil pone lo suyo (`resolverIdentidad`). Sin marca,
 * vacía.
 */
export function identidadBaseTextil(marca: MarcaTextil | null | undefined): {
  nombre: string | null;
  logo_url: string | null;
  color: string | null;
} {
  return {
    nombre: limpio(marca?.nombre),
    logo_url: limpio(marca?.logo_url),
    color: limpio(marca?.color),
  };
}

/**
 * El correo y el teléfono de contacto del PDF: los de la marca, que es con
 * quien habla el cliente; lo que la marca no tenga, los de la empresa.
 */
export function contactoPresupuestoTextil(
  marca: Pick<MarcaTextil, "email" | "telefono"> | null | undefined,
  empresa: { email?: string | null; telefono?: string | null },
): { email: string | null; telefono: string | null } {
  return {
    email: limpio(marca?.email) ?? limpio(empresa.email),
    telefono: limpio(marca?.telefono) ?? limpio(empresa.telefono),
  };
}
