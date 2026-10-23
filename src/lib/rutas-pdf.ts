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
 * La ruta de un PDF rehecho: la de siempre con la versión detrás
 * (`…/id-lq3x9k.pdf`). Un nombre nuevo es la única forma segura de que ninguna
 * caché (navegador o CDN de Supabase) siga sirviendo el anterior: reemplazar
 * el fichero en la misma ruta dejaba ver el viejo hasta una hora.
 */
export const rutaPdfVersion = (ruta: string, version: string) =>
  ruta.replace(/\.pdf$/, `-${version}.pdf`);

/**
 * La ruta del PDF de una factura: la apuntada en la fila (`pdf_url` en las de
 * tienda, `pdf_path` en las de textil), que tras rehacerlo es la de su versión;
 * si no hay, o es una URL firmada de las antiguas, la fija.
 */
export const rutaPdfGuardada = (guardada: string | null | undefined, fija: string) =>
  guardada && !/^https?:\/\//.test(guardada) ? guardada : fija;

/**
 * Cuánto se guarda en caché (navegador y CDN de Supabase) cada PDF de
 * factura, en segundos. Por defecto Supabase pone una hora, y al reemplazar
 * el fichero en la misma ruta («Rehacer PDF de facturas», el borrador que se
 * vuelve a imprimir) se seguía viendo el anterior durante esa hora.
 */
export const CACHE_PDF = "60";
