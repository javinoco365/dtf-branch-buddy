/**
 * La factura que se revisa y se edita antes de emitirla (vista previa de
 * «Emitir factura» en las tiendas y en textil).
 *
 * Lógica pura: no importa nada de `routes/` ni de integraciones.
 *
 * En la pantalla los números se escriben como texto («12,50», «1.200»), así
 * que cada línea editable guarda texto y aquí se convierte y se comprueba
 * antes de emitir. Lo que sale de aquí es exactamente lo que se emite: la
 * factura se guarda con lo escrito, no con lo que tenía el pedido.
 */
import { recargoDeIva } from "./importes";

/** Una línea tal como está en el formulario. */
export type LineaEditable = {
  descripcion: string;
  cantidad: string;
  unidad: string;
  precio_unitario: string;
  iva_rate: string;
};

/** Una línea lista para emitir. */
export type LineaEmision = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  /** Recargo de equivalencia en porcentaje, si el cliente lo lleva. */
  recargo_rate?: number;
};

/** Pasa una línea del pedido al formulario: los números, con coma decimal. */
export function lineaAEditable(l: LineaEmision): LineaEditable {
  const texto = (n: number) => String(n).replace(".", ",");
  return {
    descripcion: l.descripcion,
    cantidad: texto(l.cantidad),
    unidad: l.unidad || "ud",
    precio_unitario: texto(l.precio_unitario),
    iva_rate: texto(l.iva_rate),
  };
}

/** Una línea en blanco para añadir a mano. */
export function lineaVacia(iva = 21): LineaEditable {
  return {
    descripcion: "",
    cantidad: "1",
    unidad: "ud",
    precio_unitario: "0",
    iva_rate: String(iva),
  };
}

export type ResultadoLineas =
  { ok: true; lineas: LineaEmision[] } | { ok: false; errores: string[] };

/**
 * Un número escrito en el formulario, en formato español: la coma es siempre
 * el decimal y el punto, los miles. «40,767» son 40,767 metros (no 40.767):
 * es como el formulario escribe las cantidades del pedido. Un número solo con
 * puntos es de miles si va en grupos de tres («1.200», «12.500.000») y, si
 * no, el punto es el decimal («7.5»). Nulo si no es un número.
 *
 * No sirve el lector de factura-compra: allí «40,767» con tres decimales se
 * lee como miles, y una línea de 40,767 m salía por 40.767 m (285.369 €).
 */
export function numeroEscrito(texto: string): number | null {
  const limpio = texto.replace(/[\s€]/g, "");
  if (!/^-?[\d.,]+$/.test(limpio) || !/\d/.test(limpio)) return null;
  let normalizado: string;
  if (limpio.includes(",")) {
    if ((limpio.match(/,/g) ?? []).length > 1) return null;
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpio)) {
    normalizado = limpio.replace(/\./g, "");
  } else {
    if ((limpio.match(/\./g) ?? []).length > 1) return null;
    normalizado = limpio;
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte y comprueba las líneas del formulario. Una línea sin descripción
 * ni importes (la que se añade y se deja en blanco) se ignora; cualquier otra
 * tiene que estar completa. Los errores dicen el número de línea, empezando
 * en 1, como se ven en pantalla.
 */
export function lineasParaEmitir(editables: readonly LineaEditable[]): ResultadoLineas {
  const errores: string[] = [];
  const lineas: LineaEmision[] = [];

  editables.forEach((l, i) => {
    const n = i + 1;
    const descripcion = l.descripcion.trim();
    const enBlanco =
      descripcion === "" &&
      (numeroEscrito(l.precio_unitario) ?? 0) === 0 &&
      ["", "0", "1"].includes(l.cantidad.trim());
    if (enBlanco) return;

    const cantidad = numeroEscrito(l.cantidad);
    const precio = numeroEscrito(l.precio_unitario);
    const iva = numeroEscrito(l.iva_rate);

    if (descripcion === "") errores.push(`Línea ${n}: falta la descripción`);
    if (cantidad === null || cantidad === 0) errores.push(`Línea ${n}: la cantidad no es válida`);
    if (precio === null) errores.push(`Línea ${n}: el precio no es válido`);
    if (iva === null || iva < 0 || iva > 100) errores.push(`Línea ${n}: el IVA no es válido`);
    if (
      descripcion === "" ||
      !cantidad ||
      precio === null ||
      iva === null ||
      iva < 0 ||
      iva > 100
    ) {
      return;
    }

    lineas.push({
      descripcion,
      cantidad,
      unidad: l.unidad.trim() || "ud",
      precio_unitario: precio,
      iva_rate: iva,
    });
  });

  if (errores.length === 0 && lineas.length === 0) {
    errores.push("La factura necesita al menos una línea");
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, lineas };
}

/**
 * Pone a cada línea el recargo de equivalencia que va con su IVA (5,2 % con
 * el 21 %), o se lo quita. El recargo no se escribe a mano: lo lleva el
 * cliente, así que en la vista previa va en todas las líneas, también en las
 * que se añaden o se cambian.
 */
export function conRecargo(lineas: readonly LineaEmision[], recargo: boolean): LineaEmision[] {
  return lineas.map((l) => {
    const resto: LineaEmision = { ...l };
    delete resto.recargo_rate;
    const tipo = recargo ? recargoDeIva(l.iva_rate) : 0;
    return tipo > 0 ? { ...resto, recargo_rate: tipo } : resto;
  });
}
