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
