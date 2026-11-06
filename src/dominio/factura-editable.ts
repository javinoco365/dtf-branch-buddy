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
import { aNumero } from "./factura-compra";

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
      (aNumero(l.precio_unitario) ?? 0) === 0 &&
      ["", "0", "1"].includes(l.cantidad.trim());
    if (enBlanco) return;

    const cantidad = aNumero(l.cantidad);
    const precio = aNumero(l.precio_unitario);
    const iva = aNumero(l.iva_rate);

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
