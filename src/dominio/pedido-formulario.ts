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

import { eur, numeroJusto } from "@/lib/format";
import { leerNumeroEscrito, llevaPuntoDeMiles, numeroEnLetras } from "./numeros";

/** Los tipos de IVA que puede llevar una línea de pedido: los de España. */
export const TIPOS_IVA_PEDIDO: readonly number[] = [21, 10, 4, 0];

/** Si un IVA es uno de los que se admiten. */
export function ivaDePedidoValido(iva: number): boolean {
  return TIPOS_IVA_PEDIDO.includes(iva);
}

/**
 * Una línea que pasa de esto (cantidad × precio, sin IVA) se confirma antes de
 * guardar: en una venta de DTF por metros es casi siempre una cifra mal
 * escrita.
 */
export const LINEA_GRANDE_EUR = 10_000;

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
    // Vacíos no son 0: un precio o un IVA sin escribir se dice, no se guarda a cero.
    const precio = leerNumeroEscrito(l.precio_unitario);
    const iva = leerNumeroEscrito(l.iva_rate);
    const propios: string[] = [];
    if (!l.descripcion.trim()) {
      propios.push(`${n}: falta la descripción (escríbela o borra la línea).`);
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      propios.push(`${n}: la cantidad «${l.cantidad.trim()}» tiene que ser un número mayor que 0.`);
    }
    if (l.precio_unitario.trim() === "") {
      propios.push(`${n}: falta el precio (escribe 0 si va gratis).`);
    } else if (!Number.isFinite(precio) || precio < 0) {
      propios.push(`${n}: el precio «${l.precio_unitario.trim()}» no es un número válido.`);
    }
    if (l.iva_rate.trim() === "") {
      propios.push(`${n}: falta el IVA (escribe 0 si va sin IVA).`);
    } else if (!Number.isFinite(iva) || iva < 0) {
      propios.push(`${n}: el IVA «${l.iva_rate.trim()}» no es un número válido.`);
    } else if (!ivaDePedidoValido(iva)) {
      propios.push(`${n}: el IVA ${l.iva_rate.trim()} % no existe: tiene que ser 21, 10, 4 o 0.`);
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

/** Una cifra escrita en letra si se puede («mil quinientos»), o en número. */
function cifraLeida(n: number): string {
  return numeroEnLetras(n) ?? numeroJusto(n, 4);
}

/**
 * Lo que hay que confirmar antes de guardar un pedido que ya se lee bien:
 * cantidades o precios escritos con punto de miles («1.500» puede ser mil
 * quinientos o 1,5 mal escrito) y líneas de más de 10.000 € sin IVA. Cada
 * aviso dice la cifra que se ha leído, para que se vea el error sin abrir la
 * línea. Vacío: nada que confirmar.
 */
export function avisosAntesDeGuardar(lineas: LineaEscrita[]): string[] {
  const avisos: string[] = [];
  lineas.forEach((l, i) => {
    if (lineaEnBlanco(l)) return;
    const n = `Línea ${i + 1}`;
    const cantidad = leerNumeroEscrito(l.cantidad);
    const precio = leerNumeroEscrito(l.precio_unitario);
    for (const [que, texto, valor] of [
      ["cantidad", l.cantidad, cantidad],
      ["precio", l.precio_unitario, precio],
    ] as const) {
      if (Number.isFinite(valor) && llevaPuntoDeMiles(texto)) {
        avisos.push(
          `${n}: en ${que === "cantidad" ? "la cantidad" : "el precio"} has escrito ` +
            `${texto.trim()}: se guardará como ${cifraLeida(valor)}. ¿Es correcto?`,
        );
      }
    }
    if (Number.isFinite(cantidad) && Number.isFinite(precio)) {
      const importe = cantidad * precio;
      if (importe > LINEA_GRANDE_EUR) {
        avisos.push(
          `${n}: ${numeroJusto(cantidad, 4)} × ${eur(precio)} = ${eur(importe)} sin IVA. ` +
            "¿Es correcto?",
        );
      }
    }
  });
  return avisos;
}
