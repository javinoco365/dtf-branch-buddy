/**
 * El semáforo de estados: qué nombre y qué color lleva cada estado en
 * pantalla.
 *
 * Antes cada pantalla tenía el suyo: en Pedidos, Procesando, Imprimiendo,
 * Listo y Enviado salían en el mismo gris y «Completado» en el mismo azul
 * oscuro que la etiqueta «WooCommerce»; en Facturas, «pagada» en minúscula; en
 * Textil, el valor de la base tal cual («en_produccion»). Aquí hay una regla
 * para toda la aplicación: el mismo color quiere decir lo mismo en todas las
 * pantallas.
 *
 * Los tonos:
 *   neutro    no pide nada: aún no empieza, borrador, anulado
 *   en_curso  se está haciendo
 *   atencion  hay que hacer algo: listo para sacar, pendiente de cobro o pago
 *   bien      terminado y en orden
 *   mal       se ha torcido: cancelado, rechazado, vencido, fallido
 */

export type TonoEstado = "neutro" | "en_curso" | "atencion" | "bien" | "mal";

export type TipoEstado =
  | "pedido"
  | "pedido_textil"
  | "presupuesto"
  | "factura"
  | "compra"
  | "pago_compra"
  | "conciliacion"
  | "correo";

export interface InfoEstado {
  etiqueta: string;
  tono: TonoEstado;
}

const ESTADOS: Record<TipoEstado, Record<string, InfoEstado>> = {
  pedido: {
    pendiente: { etiqueta: "Pendiente", tono: "neutro" },
    en_produccion: { etiqueta: "Procesando", tono: "en_curso" },
    imprimiendo: { etiqueta: "Imprimiendo", tono: "en_curso" },
    listo: { etiqueta: "Listo", tono: "atencion" },
    enviado: { etiqueta: "Enviado", tono: "bien" },
    entregado: { etiqueta: "Completado", tono: "bien" },
    cancelado: { etiqueta: "Cancelado", tono: "mal" },
  },
  pedido_textil: {
    pendiente: { etiqueta: "Pendiente", tono: "neutro" },
    en_produccion: { etiqueta: "En producción", tono: "en_curso" },
    listo: { etiqueta: "Listo", tono: "atencion" },
    enviado: { etiqueta: "Enviado", tono: "bien" },
    entregado: { etiqueta: "Entregado", tono: "bien" },
    cancelado: { etiqueta: "Cancelado", tono: "mal" },
  },
  presupuesto: {
    borrador: { etiqueta: "Borrador", tono: "neutro" },
    enviado: { etiqueta: "Enviado", tono: "en_curso" },
    aceptado: { etiqueta: "Aceptado", tono: "bien" },
    facturado: { etiqueta: "Facturado", tono: "bien" },
    rechazado: { etiqueta: "Rechazado", tono: "mal" },
    caducado: { etiqueta: "Caducado", tono: "neutro" },
  },
  // Facturas y tickets emitidos: emitida es que falta cobrarla. Una anulada no
  // es un problema: ya no cuenta.
  factura: {
    borrador: { etiqueta: "Borrador", tono: "neutro" },
    emitida: { etiqueta: "Emitida", tono: "atencion" },
    pagada: { etiqueta: "Pagada", tono: "bien" },
    vencida: { etiqueta: "Vencida", tono: "mal" },
    anulada: { etiqueta: "Anulada", tono: "neutro" },
  },
  // Facturas de compra: si están dadas de alta. Lo que importa (si se debe)
  // va en `pago_compra`.
  compra: {
    borrador: { etiqueta: "Borrador", tono: "neutro" },
    registrada: { etiqueta: "Registrada", tono: "neutro" },
    borrada: { etiqueta: "Borrada", tono: "neutro" },
  },
  pago_compra: {
    pendiente: { etiqueta: "Por pagar", tono: "atencion" },
    pagada: { etiqueta: "Pagada", tono: "bien" },
  },
  conciliacion: {
    conciliada: { etiqueta: "Conciliada", tono: "bien" },
    revisar: { etiqueta: "Por revisar", tono: "atencion" },
  },
  correo: {
    enviado: { etiqueta: "Enviado", tono: "bien" },
    fallido: { etiqueta: "Fallido", tono: "mal" },
  },
};

/**
 * El nombre y el tono de un estado. Uno que no está en la lista (un valor
 * nuevo en la base) sale legible y en gris: nunca el valor crudo.
 */
export function infoEstado(tipo: TipoEstado, valor: string | null | undefined): InfoEstado {
  const v = (valor ?? "").trim().toLowerCase();
  return ESTADOS[tipo][v] ?? { etiqueta: legible(v), tono: "neutro" };
}

/** Los estados de un tipo, en su orden, para un desplegable o un filtro. */
export function estadosDe(tipo: TipoEstado): { valor: string; etiqueta: string }[] {
  return Object.entries(ESTADOS[tipo]).map(([valor, i]) => ({ valor, etiqueta: i.etiqueta }));
}

/** «en_produccion» → «En produccion»: lo mínimo para que no salga en jerga. */
export function legible(valor: string): string {
  const t = valor.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}
