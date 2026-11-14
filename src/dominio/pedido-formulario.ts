/**
 * El formulario del pedido manual: leer lo que se escribe y avisar de lo que
 * no se va a guardar.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase.
 *
 * ## Por qué
 *
 * Los números iban en campos `type="number"`, que con «12,5» escrito con coma
 * (lo normal en España) dejaban el valor vacío en algunos navegadores, y el
 * formulario lo convertía en 0 sin decir nada. Ahora se escriben como texto y
 * se leen igual que en Caja y en Cobros: con coma o con punto, y si no es un
 * número, se dice.
 *
 * Y las líneas sin descripción se descartaban al guardar, también en silencio:
 * un precio escrito en una línea a la que faltaba el nombre desaparecía. Ahora
 * solo se descarta la línea que está en blanco del todo; las demás se avisan.
 */

/**
 * Un número como lo escribe una persona: «12,5» o «12.5». Vacío o con letras,
 * NaN, para que quien lo llame lo diga en vez de tomarlo por 0. Es la lectura
 * de Caja y de Cobros.
 */
export function leerNumeroEscrito(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  const t = String(texto ?? "").trim();
  if (t === "") return Number.NaN;
  return Number(t.replace(",", "."));
}

/** Un número para enseñarlo en un campo de texto: con coma, sin ceros de más. */
export function escribirNumero(n: number): string {
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
}

/** Una línea tal como está en el formulario: los números, como texto. */
export interface LineaEscrita {
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  iva_rate: string;
  linea: "dtf" | "uv";
}

export interface LineaLeida {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_rate: number;
  linea: "dtf" | "uv";
}

/** La línea con la que nace el formulario, sin tocar: se puede descartar. */
export function lineaEnBlanco(l: LineaEscrita): boolean {
  const cantidad = leerNumeroEscrito(l.cantidad);
  const precio = leerNumeroEscrito(l.precio_unitario);
  return (
    !l.descripcion.trim() &&
    (l.cantidad.trim() === "" || cantidad === 1) &&
    (l.precio_unitario.trim() === "" || precio === 0)
  );
}

/** Las líneas para los totales en pantalla: lo que no se lee cuenta 0 hasta corregirlo. */
export function lineasParaTotales(lineas: LineaEscrita[]): LineaLeida[] {
  const n = (t: string) => {
    const v = leerNumeroEscrito(t);
    return Number.isFinite(v) ? v : 0;
  };
  return lineas.map((l) => ({
    descripcion: l.descripcion,
    cantidad: n(l.cantidad),
    precio_unitario: n(l.precio_unitario),
    iva_rate: n(l.iva_rate),
    linea: l.linea,
  }));
}

export type LecturaPedido =
  { ok: true; lineas: LineaLeida[]; envio: number } | { ok: false; errores: string[] };

/**
 * Lo que se va a guardar, o por qué no se puede. Cada problema dice su línea
 * («Línea 2: …»), para encontrarla sin buscar.
 */
export function leerPedidoEscrito(lineas: LineaEscrita[], envioTexto: string): LecturaPedido {
  const errores: string[] = [];
  const leidas: LineaLeida[] = [];

  const envio = envioTexto.trim() === "" ? 0 : leerNumeroEscrito(envioTexto);
  if (!Number.isFinite(envio) || envio < 0) {
    errores.push(`Gastos de envío: «${envioTexto.trim()}» no es un importe válido.`);
  }

  lineas.forEach((l, i) => {
    if (lineaEnBlanco(l)) return;
    const n = `Línea ${i + 1}`;
    const cantidad = leerNumeroEscrito(l.cantidad);
    const precio = l.precio_unitario.trim() === "" ? 0 : leerNumeroEscrito(l.precio_unitario);
    const iva = l.iva_rate.trim() === "" ? 0 : leerNumeroEscrito(l.iva_rate);
    const propios: string[] = [];
    if (!l.descripcion.trim()) {
      propios.push(`${n}: falta la descripción (escríbela o borra la línea).`);
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      propios.push(`${n}: la cantidad «${l.cantidad.trim()}» tiene que ser un número mayor que 0.`);
    }
    if (!Number.isFinite(precio) || precio < 0) {
      propios.push(`${n}: el precio «${l.precio_unitario.trim()}» no es un número válido.`);
    }
    if (!Number.isFinite(iva) || iva < 0) {
      propios.push(`${n}: el IVA «${l.iva_rate.trim()}» no es un número válido.`);
    }
    if (propios.length) {
      errores.push(...propios);
      return;
    }
    leidas.push({
      descripcion: l.descripcion.trim(),
      cantidad,
      precio_unitario: precio,
      iva_rate: iva,
      linea: l.linea,
    });
  });

  if (errores.length === 0 && leidas.length === 0) errores.push("Añade al menos una línea.");
  if (errores.length) return { ok: false, errores };
  return { ok: true, lineas: leidas, envio };
}
