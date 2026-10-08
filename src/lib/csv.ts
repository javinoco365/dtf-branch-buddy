/**
 * Descarga de tablas como CSV desde el navegador.
 *
 * Vivía dentro de `demo-data.ts`, que era un generador de datos falsos, pero
 * esto no tiene nada de falso: es la exportación real que usan el cuadro de
 * mando, las dos pantallas de facturación y la tabla de pedidos.
 */

/**
 * El texto de un CSV, con el BOM de UTF-8 delante: sin él, Excel en español
 * abre el fichero como Latin-1 y destroza todos los acentos y las eñes.
 */
export function textoCSV(filas: (string | number)[][]): string {
  const csv = filas
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return "\uFEFF" + csv;
}

/** Descarga un fichero generado en el navegador. */
export function descargarBlob(nombre: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  // Con un respiro: algún navegador todavía está leyendo el enlace cuando
  // vuelve el clic, y revocarlo en el acto deja una descarga vacía.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Genera un CSV y lo descarga. */
export function descargarCSV(nombre: string, filas: (string | number)[][]) {
  descargarBlob(nombre, new Blob([textoCSV(filas)], { type: "text/csv;charset=utf-8;" }));
}
