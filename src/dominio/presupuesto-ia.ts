/**
 * Presupuestos montados con IA: desde un documento (PDF o imagen) o desde un
 * texto libre («50 camisetas Gildan negras talla M con logo en pecho, 10 €
 * cada una, para Pepe SL»).
 *
 * La IA PROPONE: devuelve una lectura con la forma de
 * `ESQUEMA_LECTURA_PRESUPUESTO_JSON`, que aquí se valida (`validarLecturaPresupuesto`)
 * y se convierte en un borrador del MODELO DE SIEMPRE (`montarBorradorTienda`,
 * `montarBorradorTextil`): las mismas líneas, el mismo cliente y los mismos
 * campos que rellena el editor a mano. Nada se guarda aquí: el borrador abre
 * el editor de siempre y lo guarda la persona, que es quien revisa.
 *
 * Reglas de los precios (en este orden):
 *   1. el que diga el documento o el texto (si dice que lleva IVA, se pasa a
 *      base con el IVA del presupuesto, y se avisa);
 *   2. si no dice, el del catálogo (precio del producto de la tienda o
 *      precio de venta de la variante textil), como cuando se elige a mano;
 *   3. si tampoco, vacío y se avisa. Nunca uno inventado.
 *
 * Lógica pura: sin red ni base de datos. Los totales y el IVA no se calculan
 * aquí: los calcula el editor con `totalesPresupuesto` y `calcularTotales`,
 * como siempre.
 */

import { z } from "zod";
import { aFecha, aNumero } from "./factura-compra";
import { IVA_GENERAL, UNIDAD_POR_DEFECTO, redondear } from "./importes";
import { normalizarNif, normalizarTexto } from "./clientes";
import { etiquetaVariante, utilizable } from "./stock-textil";
import type { VarianteCatalogo } from "./tipos-textil";

// ---------------------------------------------------------------------------
// Lo que se le pide a la IA
// ---------------------------------------------------------------------------

/** Las respuestas de sí/no, con «no se sabe» como texto vacío. */
const SI_NO = ["si", "no", ""] as const;

/** Un texto que puede ir vacío: sin uniones (`anyOf`), por el límite de la API. */
const texto = { type: "string" } as const;

/**
 * La lectura en JSON Schema, para la salida estructurada de la API. Todo es
 * texto («» si no aparece) y todo es obligatorio: ni una unión ni un campo
 * opcional, así cabe de sobra en los límites de la API (16 uniones y 24
 * opcionales: lo comprueba la prueba).
 */
export const ESQUEMA_LECTURA_PRESUPUESTO_JSON = {
  type: "object",
  additionalProperties: false,
  required: [
    "cliente_nombre",
    "cliente_email",
    "cliente_telefono",
    "cliente_nif",
    "cliente_direccion",
    "fecha",
    "validez_dias",
    "con_iva",
    "envio",
    "notas",
    "lineas",
    "dudas",
  ],
  properties: {
    cliente_nombre: texto,
    cliente_email: texto,
    cliente_telefono: texto,
    cliente_nif: texto,
    cliente_direccion: texto,
    fecha: texto,
    validez_dias: texto,
    con_iva: { type: "string", enum: [...SI_NO] },
    envio: texto,
    notas: texto,
    dudas: { type: "array", items: { type: "string" } },
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "catalogo_id",
          "descripcion",
          "cantidad",
          "unidad",
          "precio_unitario",
          "importe",
          "precio_con_iva",
        ],
        properties: {
          catalogo_id: texto,
          descripcion: texto,
          cantidad: texto,
          unidad: texto,
          precio_unitario: texto,
          importe: texto,
          precio_con_iva: { type: "string", enum: [...SI_NO] },
        },
      },
    },
  },
} as const;

/** Como mucho, tantas líneas: un presupuesto no lleva más, y frena una respuesta desbocada. */
export const MAXIMO_LINEAS_IA = 200;

const lineaLeida = z.object({
  catalogo_id: z.string(),
  descripcion: z.string(),
  cantidad: z.string(),
  unidad: z.string(),
  precio_unitario: z.string(),
  importe: z.string(),
  precio_con_iva: z.enum(SI_NO),
});

const esquemaLectura = z.object({
  cliente_nombre: z.string(),
  cliente_email: z.string(),
  cliente_telefono: z.string(),
  cliente_nif: z.string(),
  cliente_direccion: z.string(),
  fecha: z.string(),
  validez_dias: z.string(),
  con_iva: z.enum(SI_NO),
  envio: z.string(),
  notas: z.string(),
  lineas: z.array(lineaLeida).max(MAXIMO_LINEAS_IA),
  dudas: z.array(z.string()),
});

export type LecturaPresupuesto = z.infer<typeof esquemaLectura>;
export type LineaLeidaPresupuesto = z.infer<typeof lineaLeida>;

/** Valida la salida de la IA. Si no vale, dice por qué, en castellano. */
export function validarLecturaPresupuesto(
  bruto: unknown,
): { ok: true; lectura: LecturaPresupuesto } | { ok: false; error: string } {
  const r = esquemaLectura.safeParse(bruto);
  if (r.success) return { ok: true, lectura: r.data };
  const primero = r.error.issues[0];
  const donde = primero?.path.join(".") || "la respuesta";
  const que =
    primero?.code === "invalid_type"
      ? primero.received === "undefined"
        ? "falta"
        : "no es del tipo esperado"
      : primero?.code === "too_big"
        ? "es demasiado larga"
        : primero?.code === "invalid_enum_value"
          ? "no es un valor permitido"
          : "no es válido";
  return {
    ok: false,
    error: `La IA ha devuelto un presupuesto sin la forma esperada: ${donde} ${que}.`,
  };
}

// ---------------------------------------------------------------------------
// El catálogo que se le enseña a la IA
// ---------------------------------------------------------------------------

/** Un producto del catálogo de una tienda: los de la tienda y los generales. */
export type ProductoCatalogoIa = {
  id: string;
  nombre: string;
  descripcion?: string | null;
  unidad: string;
  precio_unitario: number;
};

/** Como mucho, tantas entradas del catálogo en la petición: el resto se dice que falta. */
export const MAXIMO_CATALOGO_IA = 600;

const limpio = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const precioTexto = (n: number) => (n > 0 ? `${redondear(n, 4)} €` : "sin precio");

/**
 * El catálogo de la tienda, en texto, una entrada por línea:
 * `id | nombre | unidad | precio sin IVA`. La IA elige de aquí el
 * `catalogo_id` de cada línea; si no hay ninguno que encaje, lo deja vacío.
 */
export function catalogoTiendaParaIa(productos: readonly ProductoCatalogoIa[]): string {
  const lista = productos.slice(0, MAXIMO_CATALOGO_IA);
  const filas = lista.map((p) =>
    [
      p.id,
      limpio(p.nombre),
      limpio(p.descripcion),
      p.unidad,
      precioTexto(Number(p.precio_unitario)),
    ]
      .filter((x, i) => i !== 2 || x)
      .join(" | "),
  );
  const resto = productos.length - lista.length;
  return [
    filas.length ? filas.join("\n") : "(la tienda no tiene productos en el catálogo)",
    resto > 0 ? `(y ${resto} productos más que no caben aquí)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Las variantes de stock textil que se pueden vender, en texto:
 * `id | marca · modelo · color · talla | SKU | precio de venta sin IVA | disponibles`.
 */
export function catalogoTextilParaIa(variantes: readonly VarianteCatalogo[]): string {
  const vendibles = variantes.filter(utilizable);
  const lista = vendibles.slice(0, MAXIMO_CATALOGO_IA);
  const filas = lista.map((v) =>
    [
      v.id,
      etiquetaVariante(v),
      v.sku ? `SKU ${v.sku}` : "",
      precioTexto(Number(v.precio_venta)),
      `${redondear(Number(v.cantidad) - Number(v.cantidad_reservada), 2)} disponibles`,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  const resto = vendibles.length - lista.length;
  return [
    filas.length ? filas.join("\n") : "(no hay variantes de stock dadas de alta)",
    resto > 0 ? `(y ${resto} variantes más que no caben aquí)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// El cliente
// ---------------------------------------------------------------------------

/** Un cliente de la ficha, con lo que usan los editores. */
export type ClienteCandidato = {
  id: string;
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  nif?: string | null;
  direccion?: string | null;
};

/**
 * El cliente de la ficha que es el de la lectura: por correo, si no por NIF
 * y, si no, por nombre exacto (sin tildes ni mayúsculas). Solo si hay uno: con
 * dos posibles no se elige ninguno.
 */
export function casarCliente<C extends ClienteCandidato>(
  l: Pick<LecturaPresupuesto, "cliente_nombre" | "cliente_email" | "cliente_nif">,
  clientes: readonly C[],
): C | null {
  const unico = (lista: C[]) => (lista.length === 1 ? lista[0] : null);
  const email = l.cliente_email.trim().toLowerCase();
  if (email) {
    const r = unico(clientes.filter((c) => (c.email ?? "").trim().toLowerCase() === email));
    if (r) return r;
  }
  const nif = normalizarNif(l.cliente_nif);
  if (nif) {
    const r = unico(clientes.filter((c) => normalizarNif(c.nif) === nif));
    if (r) return r;
  }
  const nombre = normalizarTexto(l.cliente_nombre);
  if (nombre) {
    return unico(clientes.filter((c) => normalizarTexto(c.nombre) === nombre));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Los números de una línea
// ---------------------------------------------------------------------------

/** Un número leído, o null. Vacío, cero o negativo no valen como cantidad. */
const positivo = (s: string): number | null => {
  const n = aNumero(s);
  return n !== null && n > 0 ? n : null;
};

/** Un precio leído: cero vale (una línea de regalo), negativo no. */
const noNegativo = (s: string): number | null => {
  const n = aNumero(s);
  return n !== null && n >= 0 ? n : null;
};

/**
 * El precio sin IVA de una línea según lo que dice el papel, o null si no lo
 * dice. Si solo da el importe de la línea, se divide entre la cantidad. Si dice
 * que lleva IVA, se pasa a base con `ivaPct` (cuatro decimales, como guarda la
 * base de datos).
 */
export function precioLeido(
  l: Pick<LineaLeidaPresupuesto, "precio_unitario" | "importe" | "precio_con_iva">,
  cantidad: number | null,
  ivaPct: number,
): { precio: number | null; conIvaQuitado: boolean } {
  let precio = noNegativo(l.precio_unitario);
  if (precio === null && cantidad) {
    const importe = noNegativo(l.importe);
    if (importe !== null) precio = importe / cantidad;
  }
  if (precio === null) return { precio: null, conIvaQuitado: false };
  const quitar = l.precio_con_iva === "si" && ivaPct > 0;
  return {
    precio: redondear(quitar ? precio / (1 + ivaPct / 100) : precio, 4),
    conIvaQuitado: quitar,
  };
}

/** Las unidades como las escribe la gente → las del editor (8 letras como mucho). */
export function unidadNormalizada(u: string): string | null {
  const t = normalizarTexto(u).replace(/\.$/, "");
  if (!t) return null;
  if (["m", "metro", "metros", "ml", "mts", "mt"].includes(t)) return "m";
  if (["ud", "uds", "u", "unidad", "unidades", "pieza", "piezas", "pza", "pzas"].includes(t)) {
    return "ud";
  }
  if (["m2", "m²", "metro cuadrado", "metros cuadrados"].includes(t)) return "m2";
  return t.length <= 8 ? t : null;
}

const numeroLinea = (i: number) => `Línea ${i + 1}`;

// ---------------------------------------------------------------------------
// El borrador de una tienda
// ---------------------------------------------------------------------------

export type LineaBorradorTienda = {
  producto_id: string | null;
  descripcion: string;
  /** null: el papel no la dice; el editor la deja vacía y pide rellenarla. */
  cantidad: number | null;
  unidad: string;
  /** Sin IVA. null: ni el papel ni el catálogo lo dicen. */
  precio_unitario: number | null;
};

export type BorradorTienda = {
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_email: string;
  cliente_telefono: string;
  fecha: string;
  validez_dias: number;
  envio: number;
  aplica_iva: boolean;
  notas: string;
  lineas: LineaBorradorTienda[];
  /** Lo que hay que mirar antes de guardar: las dudas de la IA y lo que se ha visto aquí. */
  avisos: string[];
};

/** La validez de un presupuesto nuevo, la de siempre (la de la base y los editores). */
export const VALIDEZ_POR_DEFECTO = 30;

/** Lo común a los dos borradores: fecha, validez, IVA, notas y cliente. */
function cabecera<C extends ClienteCandidato>(
  l: LecturaPresupuesto,
  clientes: readonly C[],
  hoy: string,
  avisos: string[],
) {
  const fecha = aFecha(l.fecha) ?? hoy;
  if (l.fecha.trim() && !aFecha(l.fecha)) {
    avisos.push(`No se entiende la fecha «${l.fecha.trim()}»: se pone la de hoy.`);
  }
  const validezLeida = positivo(l.validez_dias);
  const validez_dias = validezLeida ? Math.round(validezLeida) : VALIDEZ_POR_DEFECTO;
  const aplica_iva = l.con_iva !== "no";
  const cliente = casarCliente(l, clientes);
  if (!cliente && !l.cliente_nombre.trim()) {
    avisos.push("No se dice para qué cliente es: elígelo o escríbelo.");
  } else if (!cliente) {
    avisos.push(
      `«${l.cliente_nombre.trim()}» no está en la ficha de clientes: va sin ficha. Elígelo si ya existe con otro nombre.`,
    );
  }
  return { fecha, validez_dias, aplica_iva, cliente };
}

/**
 * La lectura de la IA hecha presupuesto de tienda, con el catálogo de la
 * tienda. `hoy`, `yyyy-MM-dd`: la fecha si el papel no la dice.
 */
export function montarBorradorTienda(
  l: LecturaPresupuesto,
  contexto: {
    productos: readonly ProductoCatalogoIa[];
    clientes: readonly ClienteCandidato[];
    hoy: string;
  },
): BorradorTienda {
  const avisos = l.dudas.map((d) => d.trim()).filter(Boolean);
  const c = cabecera(l, contexto.clientes, contexto.hoy, avisos);
  const iva = c.aplica_iva ? IVA_GENERAL : 0;
  const porId = new Map(contexto.productos.map((p) => [p.id, p]));

  const lineas = l.lineas.map((ll, i): LineaBorradorTienda => {
    const id = ll.catalogo_id.trim();
    const producto = id ? (porId.get(id) ?? null) : null;
    if (id && !producto) {
      avisos.push(
        `${numeroLinea(i)}: la IA ha citado un producto que no está en el catálogo; va como línea libre.`,
      );
    }
    const cantidad = positivo(ll.cantidad);
    if (cantidad === null) avisos.push(`${numeroLinea(i)}: falta la cantidad.`);
    const leido = precioLeido(ll, cantidad, iva);
    if (leido.conIvaQuitado) {
      avisos.push(`${numeroLinea(i)}: el precio venía con IVA; se ha pasado a base. Revísalo.`);
    }
    let precio = leido.precio;
    if (precio === null && producto && Number(producto.precio_unitario) > 0) {
      precio = Number(producto.precio_unitario);
    }
    if (precio === null)
      avisos.push(`${numeroLinea(i)}: no hay precio, ni en el texto ni en el catálogo.`);
    const descripcion = ll.descripcion.trim() || producto?.nombre || "";
    if (!descripcion) avisos.push(`${numeroLinea(i)}: falta la descripción.`);
    return {
      producto_id: producto?.id ?? null,
      descripcion,
      cantidad,
      unidad: producto?.unidad || unidadNormalizada(ll.unidad) || UNIDAD_POR_DEFECTO,
      precio_unitario: precio,
    };
  });
  if (lineas.length === 0) avisos.push("La IA no ha encontrado ninguna línea: añádelas a mano.");

  const envioLeido = noNegativo(l.envio);
  if (l.envio.trim() && envioLeido === null) {
    avisos.push(`No se entiende el envío «${l.envio.trim()}»: se deja a cero.`);
  }

  return {
    cliente_id: c.cliente?.id ?? null,
    cliente_nombre: c.cliente?.nombre ?? l.cliente_nombre.trim(),
    cliente_email: l.cliente_email.trim() || c.cliente?.email || "",
    cliente_telefono: l.cliente_telefono.trim() || c.cliente?.telefono || "",
    fecha: c.fecha,
    validez_dias: c.validez_dias,
    envio: envioLeido ?? 0,
    aplica_iva: c.aplica_iva,
    notas: l.notas.trim(),
    lineas,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// El borrador textil
// ---------------------------------------------------------------------------

export type LineaBorradorTextil = {
  stock_id: string | null;
  descripcion: string;
  cantidad: number | null;
  /** Sin IVA. null: ni el papel ni el precio de venta de la variante lo dicen. */
  precio_unitario: number | null;
  iva_pct: number;
};

export type BorradorTextil = {
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_email: string;
  cliente_nif: string;
  cliente_direccion: string;
  fecha: string;
  validez_dias: number;
  notas: string;
  lineas: LineaBorradorTextil[];
  avisos: string[];
};

/** La lectura de la IA hecha presupuesto textil, con las variantes de stock. */
export function montarBorradorTextil(
  l: LecturaPresupuesto,
  contexto: {
    variantes: readonly VarianteCatalogo[];
    clientes: readonly ClienteCandidato[];
    hoy: string;
  },
): BorradorTextil {
  const avisos = l.dudas.map((d) => d.trim()).filter(Boolean);
  const c = cabecera(l, contexto.clientes, contexto.hoy, avisos);
  const iva = c.aplica_iva ? IVA_GENERAL : 0;
  const porId = new Map(contexto.variantes.map((v) => [v.id, v]));

  const lineas = l.lineas.map((ll, i): LineaBorradorTextil => {
    const id = ll.catalogo_id.trim();
    const encontrada = id ? (porId.get(id) ?? null) : null;
    const variante = encontrada && utilizable(encontrada) ? encontrada : null;
    if (id && !encontrada) {
      avisos.push(
        `${numeroLinea(i)}: la IA ha citado una variante que no está en el stock; va sin stock.`,
      );
    } else if (encontrada && !variante) {
      avisos.push(
        `${numeroLinea(i)}: la variante que encaja está desactivada o repetida; va sin stock.`,
      );
    }
    const cantidad = positivo(ll.cantidad);
    if (cantidad === null) avisos.push(`${numeroLinea(i)}: falta la cantidad.`);
    const leido = precioLeido(ll, cantidad, iva);
    if (leido.conIvaQuitado) {
      avisos.push(`${numeroLinea(i)}: el precio venía con IVA; se ha pasado a base. Revísalo.`);
    }
    let precio = leido.precio;
    if (precio === null && variante && Number(variante.precio_venta) > 0) {
      precio = Number(variante.precio_venta);
    }
    if (precio === null) {
      avisos.push(
        `${numeroLinea(i)}: no hay precio, ni en el texto ni en el precio de venta del stock.`,
      );
    }
    const descripcion = ll.descripcion.trim() || (variante ? etiquetaVariante(variante) : "");
    if (!descripcion) avisos.push(`${numeroLinea(i)}: falta la descripción.`);
    return {
      stock_id: variante?.id ?? null,
      descripcion,
      cantidad,
      precio_unitario: precio,
      iva_pct: iva,
    };
  });
  if (lineas.length === 0) avisos.push("La IA no ha encontrado ninguna línea: añádelas a mano.");
  if (l.envio.trim() && noNegativo(l.envio)) {
    avisos.push(
      `El texto habla de un envío de ${l.envio.trim()}: los presupuestos textil no llevan envío aparte; añádelo como línea si va.`,
    );
  }

  return {
    cliente_id: c.cliente?.id ?? null,
    cliente_nombre: c.cliente?.nombre ?? l.cliente_nombre.trim(),
    cliente_email: l.cliente_email.trim() || c.cliente?.email || "",
    cliente_nif: l.cliente_nif.trim() || c.cliente?.nif || "",
    cliente_direccion: l.cliente_direccion.trim() || c.cliente?.direccion || "",
    fecha: c.fecha,
    validez_dias: c.validez_dias,
    notas: l.notas.trim(),
    lineas,
    avisos,
  };
}
