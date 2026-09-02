/**
 * Descarga de tablas como CSV desde el navegador.
 *
 * Vivía dentro de `demo-data.ts`, que era un generador de datos falsos, pero
 * esto no tiene nada de falso: es la exportación real que usan el cuadro de
 * mando, las dos pantallas de facturación y la tabla de pedidos.
 */

/**
 * Genera un CSV y lo descarga.
 *
 * Antepone el BOM de UTF-8 porque sin él Excel en español abre el fichero como
 * Latin-1 y destroza todos los acentos y las eñes.
 */
export function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const csv = filas
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
