/**
 * Dónde vive cada PDF en el bucket privado `facturas`. Un solo sitio para que
 * guardarlo, abrirlo, borrarlo y empaquetarlo en el archivo usen la misma
 * ruta.
 */

/** El PDF A4 de una factura o ticket de tienda. */
export const rutaPdfTienda = (tiendaId: string, facturaId: string) =>
  `${tiendaId}/${facturaId}.pdf`;

/** El PDF A4 de una factura o ticket textil. */
export const rutaPdfTextil = (facturaId: string) => `textil/${facturaId}.pdf`;

/**
 * Cuánto se guarda en caché (navegador y CDN de Supabase) cada PDF de
 * factura, en segundos. Por defecto Supabase pone una hora, y al reemplazar
 * el fichero en la misma ruta («Rehacer PDF de facturas», el borrador que se
 * vuelve a imprimir) se seguía viendo el anterior durante esa hora.
 */
export const CACHE_PDF = "60";
