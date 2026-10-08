/**
 * El archivo de documentos: qué entra, cómo se llama cada fichero dentro del
 * ZIP y cómo se llama el ZIP.
 *
 * Lógica pura: no sabe de Supabase ni del navegador. La pantalla Archivo y el
 * botón «Descargar PDFs» de cada lista convierten sus filas con las funciones
 * de abajo y montan el ZIP con lo que devuelve `rutasEnZip`.
 *
 * Dentro del ZIP cada documento va en la carpeta de su clase y en una
 * subcarpeta por trimestre (la del 303), con un nombre que se lee en el
 * Explorador de Windows sin caracteres rotos:
 *
 *   emitidas/2026-T3/2026-0012_Club-Nautico.pdf
 *   tickets/2026-T3/T2026-0045_Pena-Sport.pdf
 *   rectificativas/2026-T3/R2026-0001_Club-Nautico.pdf
 *   compras/2026-T3/2026-07-14_Proveedor-SL_FAC-123.jpg
 */

import type { Rango, Seleccion } from "./periodos";

export type OrigenArchivo = "tienda" | "textil" | "compra";
export type ClaseArchivo = "emitida" | "ticket" | "rectificativa" | "compra";

export const CLASES_ARCHIVO: readonly { valor: ClaseArchivo; etiqueta: string }[] = [
  { valor: "emitida", etiqueta: "Facturas emitidas" },
  { valor: "ticket", etiqueta: "Tickets" },
  { valor: "rectificativa", etiqueta: "Rectificativas" },
  { valor: "compra", etiqueta: "Facturas de compra" },
];

const CARPETA: Record<ClaseArchivo, string> = {
  emitida: "emitidas",
  ticket: "tickets",
  rectificativa: "rectificativas",
  compra: "compras",
};

/** Un documento del archivo, venga de donde venga. */
export type DocArchivo = {
  origen: OrigenArchivo;
  clase: ClaseArchivo;
  id: string;
  /** 'yyyy-mm-dd', o null si la compra no tiene fecha. */
  fecha: string | null;
  /** La referencia ya compuesta (2026/0012, T2026/0045) o el número del proveedor. */
  referencia: string;
  /** Cliente o proveedor. */
  tercero: string | null;
  nif: string | null;
  /** La tienda, la marca textil o, en compras, nada. */
  procedencia: string | null;
  base: number;
  iva: number;
  total: number;
  estado: string;
  /** Extensión del fichero: pdf en ventas; la real en compras (jpg, png…). */
  ext: string;
  /** Si tiene el fichero guardado. Una venta sin él se genera antes de empaquetar. */
  tieneFichero: boolean;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** '2026-08-14' → '2026-T3'. Lee el texto, sin pasar por Date (no hay husos que valgan). */
export function trimestreDe(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(fecha ?? "");
  if (!m) return "sin-fecha";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "sin-fecha";
  return `${m[1]}-T${Math.floor((mes - 1) / 3) + 1}`;
}

/**
 * Un trozo de nombre de fichero que se lee bien en cualquier sistema: sin
 * tildes, sin barras ni caracteres raros, con guiones en vez de espacios y
 * con un tope de largo.
 */
export function sanearNombre(texto: string | null | undefined, max = 60): string {
  const limpio = (texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, max)
    .replace(/[-._]+$/g, "");
  return limpio || "sin-nombre";
}

/** La extensión de una ruta de Storage, en minúsculas; pdf si no se sabe. */
export function extensionDe(ruta: string | null | undefined): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(ruta ?? "");
  return m ? m[1].toLowerCase() : "pdf";
}

/** Dónde va un documento dentro del ZIP, sin resolver repetidos. */
export function rutaEnZip(doc: DocArchivo): string {
  const carpeta = `${CARPETA[doc.clase]}/${trimestreDe(doc.fecha)}`;
  // Una venta sin cliente (un ticket, casi siempre) se queda con su número.
  const nombre =
    doc.clase === "compra"
      ? [doc.fecha ?? "sin-fecha", sanearNombre(doc.tercero, 40), sanearNombre(doc.referencia, 30)]
      : [
          sanearNombre(doc.referencia, 30),
          ...(doc.tercero?.trim() ? [sanearNombre(doc.tercero, 40)] : []),
        ];
  return `${carpeta}/${nombre.join("_")}.${doc.ext || "pdf"}`;
}

/**
 * Las rutas de todos, sin dos iguales: a la segunda se le añade _2, a la
 * tercera _3… Dos compras del mismo proveedor, el mismo día y sin número
 * acabarían si no pisándose dentro del ZIP.
 */
export function rutasEnZip(docs: readonly DocArchivo[]): string[] {
  const usadas = new Set<string>();
  return docs.map((d) => {
    const ruta = rutaEnZip(d);
    if (!usadas.has(ruta.toLowerCase())) {
      usadas.add(ruta.toLowerCase());
      return ruta;
    }
    const punto = ruta.lastIndexOf(".");
    for (let n = 2; ; n++) {
      const otra = `${ruta.slice(0, punto)}_${n}${ruta.slice(punto)}`;
      if (!usadas.has(otra.toLowerCase())) {
        usadas.add(otra.toLowerCase());
        return otra;
      }
    }
  });
}

const dos = (n: number) => String(n).padStart(2, "0");
const dia = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

/** El nombre del ZIP según el periodo: Archivo_2026-T3.zip, Archivo_2026-10.zip… */
export function nombreZip(sel: Seleccion, rango: Rango | null, prefijo = "Archivo"): string {
  const r = rango;
  let parte: string;
  if (sel.tipo === "todo" || !r) parte = "completo";
  else if (sel.tipo === "trimestre")
    parte = `${sel.ref.getFullYear()}-T${Math.floor(sel.ref.getMonth() / 3) + 1}`;
  else if (sel.tipo === "mes") parte = `${sel.ref.getFullYear()}-${dos(sel.ref.getMonth() + 1)}`;
  else if (sel.tipo === "anio") parte = String(sel.ref.getFullYear());
  else if (sel.tipo === "hoy") parte = dia(r.desde);
  else parte = `${dia(r.desde)}_a_${dia(r.hasta)}`;
  return `${sanearNombre(prefijo, 40)}_${parte}.zip`;
}

/** Cuántos hay de cada clase y cuántos sin fichero. */
export function resumenArchivo(docs: readonly DocArchivo[]) {
  const porClase: Record<ClaseArchivo, number> = {
    emitida: 0,
    ticket: 0,
    rectificativa: 0,
    compra: 0,
  };
  let sinFichero = 0;
  for (const d of docs) {
    porClase[d.clase]++;
    if (!d.tieneFichero) sinFichero++;
  }
  return { total: docs.length, porClase, sinFichero };
}

/**
 * El índice del ZIP (indice.csv): una fila por documento, con su ruta dentro.
 * Los importes se formatean fuera, con `importe` (lib/format.ts).
 */
export function filasIndice(
  docs: readonly DocArchivo[],
  rutas: readonly (string | null)[],
  importe: (n: number) => string | number = (n) => n,
): (string | number)[][] {
  const cabecera = [
    "Fichero",
    "Clase",
    "Procedencia",
    "Referencia",
    "Fecha",
    "Cliente o proveedor",
    "NIF",
    "Base",
    "IVA",
    "Total",
    "Estado",
  ];
  const etiqueta = (c: ClaseArchivo) => CLASES_ARCHIVO.find((x) => x.valor === c)!.etiqueta;
  return [
    cabecera,
    ...docs.map((d, i) => [
      rutas[i] ?? "(falta el fichero)",
      etiqueta(d.clase),
      d.procedencia ?? "",
      d.referencia,
      d.fecha ?? "",
      d.tercero ?? "",
      d.nif ?? "",
      importe(d.base),
      importe(d.iva),
      importe(d.total),
      d.estado,
    ]),
  ];
}

/* --------------------------------------------------------------------------
 * De cada tabla a un documento del archivo
 * ------------------------------------------------------------------------ */

/** La clase de una factura de venta por su tipo. */
export function claseDeTipo(tipo: string | null | undefined): ClaseArchivo {
  if (tipo === "simplificada") return "ticket";
  if (tipo === "rectificativa") return "rectificativa";
  return "emitida";
}

export type FilaFacturaTienda = {
  id: string;
  tipo?: string | null;
  estado?: string | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  cliente_nif?: string | null;
  base_imponible?: number | string | null;
  iva_total?: number | string | null;
  total?: number | string | null;
  pdf_url?: string | null;
};

/** Una factura o ticket de tienda. `referencia` la compone quien llama (referenciaFactura). */
export function deFacturaTienda(
  f: FilaFacturaTienda,
  referencia: string,
  tienda: string | null,
): DocArchivo {
  return {
    origen: "tienda",
    clase: claseDeTipo(f.tipo),
    id: f.id,
    fecha: f.fecha ? f.fecha.slice(0, 10) : null,
    referencia,
    tercero: f.cliente_nombre ?? null,
    nif: f.cliente_nif ?? null,
    procedencia: tienda,
    base: num(f.base_imponible),
    iva: num(f.iva_total),
    total: num(f.total),
    estado: String(f.estado ?? ""),
    ext: "pdf",
    tieneFichero: !!f.pdf_url,
  };
}

export type FilaFacturaTextil = {
  id: string;
  numero?: string | null;
  tipo?: string | null;
  estado?: string | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  cliente_nif?: string | null;
  subtotal?: number | string | null;
  iva?: number | string | null;
  total?: number | string | null;
  pdf_path?: string | null;
  marca?: { nombre?: string | null } | null;
};

export function deFacturaTextil(f: FilaFacturaTextil): DocArchivo {
  return {
    origen: "textil",
    clase: claseDeTipo(f.tipo),
    id: f.id,
    fecha: f.fecha ? f.fecha.slice(0, 10) : null,
    referencia: f.numero ?? "",
    tercero: f.cliente_nombre ?? null,
    nif: f.cliente_nif ?? null,
    procedencia: f.marca?.nombre ? `Textil · ${f.marca.nombre}` : "Textil",
    base: num(f.subtotal),
    iva: num(f.iva),
    total: num(f.total),
    estado: String(f.estado ?? ""),
    ext: "pdf",
    tieneFichero: !!f.pdf_path,
  };
}

export type FilaCompra = {
  id: string;
  fecha?: string | null;
  proveedor?: string | null;
  nif_proveedor?: string | null;
  numero?: string | null;
  base?: number | string | null;
  iva?: number | string | null;
  total?: number | string | null;
  liquido?: number | string | null;
  estado?: string | null;
  borrada_en?: string | null;
  fichero_ruta?: string | null;
};

export function deCompra(c: FilaCompra): DocArchivo {
  return {
    origen: "compra",
    clase: "compra",
    id: c.id,
    fecha: c.fecha ? c.fecha.slice(0, 10) : null,
    referencia: c.numero ?? "",
    tercero: c.proveedor ?? null,
    nif: c.nif_proveedor ?? null,
    procedencia: null,
    base: num(c.base),
    iva: num(c.iva),
    total: num(c.liquido ?? c.total),
    estado: c.borrada_en ? "borrada" : String(c.estado ?? ""),
    ext: extensionDe(c.fichero_ruta),
    tieneFichero: !!c.fichero_ruta,
  };
}

/**
 * Lo que entra en el archivo: nada de borradores (no tienen número) ni de
 * compras borradas o sin registrar (no cuentan). Las facturas anuladas sí
 * entran, junto a su rectificativa: las dos están en el libro.
 */
export function entraEnArchivo(doc: DocArchivo): boolean {
  if (doc.estado === "borrador" || doc.estado === "borrada") return false;
  if (doc.clase === "compra") return doc.estado === "registrada";
  return true;
}
