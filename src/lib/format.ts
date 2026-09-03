export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number(n ?? 0));

export const fechaCorta = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

export const fechaLarga = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const numero = (n: number | null | undefined, decimales = 2) =>
  new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Number(n ?? 0));

export const metros = (n: number | null | undefined) => `${numero(n, 2)} m`;

/**
 * La referencia visible de una factura: 2026/0001, R2026/0001.
 *
 * Réplica exacta de public.factura_referencia(). La base es la fuente de
 * verdad —ahí se congela en el documento—; esto es solo para pintar en
 * pantalla sin una ida y vuelta.
 */
export function referenciaFactura(
  serie: string | null,
  ejercicio: number | null,
  numero: number | null,
): string {
  if (ejercicio == null || numero == null) return "—";
  return `${serie ?? ""}${ejercicio}/${String(numero).padStart(4, "0")}`;
}
