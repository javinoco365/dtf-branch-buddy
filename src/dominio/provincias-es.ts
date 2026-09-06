/**
 * El nombre completo de una provincia española, a partir del código corto.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos.
 *
 * ## De dónde sale el código
 *
 * WooCommerce no guarda «Huelva»: guarda el código corto de su propia lista de
 * provincias («H»), que es la que usa el desplegable de dirección de la
 * tienda. Ese código es el que llega en `billing.state` / `shipping.state` y
 * el que `direccionWoo()` copia tal cual en `provincia`.
 *
 * Sin esta conversión, una etiqueta de envío salía con «H» en vez de
 * «Huelva», que no significa nada para el transportista ni para quien la lee.
 *
 * ## Por qué no se traduce al guardar
 *
 * El código se queda tal cual en `pedidos.direccion_facturacion` /
 * `direccion_envio`: es el dato que llega de Woo, y la migración documenta esa
 * forma. La conversión se hace solo al pintar la dirección, en
 * `lineasDireccion()`, que es el único sitio que la imprime. Así un cambio
 * aquí —un código que faltara, una lista distinta— no pide re-sincronizar
 * nada.
 *
 * ## Qué pasa con lo que no se reconoce
 *
 * Un pedido manual trae el nombre completo escrito a mano («Huelva», no
 * «H»), y estos códigos son siempre de una o dos letras: nunca van a coincidir
 * con un nombre completo de provincia, así que no hay que distinguir el origen
 * del dato. Lo que no está en la lista —un código de fuera de España, un
 * texto libre— se devuelve tal cual: es mejor enseñar lo que hay que dejar la
 * línea en blanco.
 */

/**
 * Código de WooCommerce → nombre completo. Es la misma lista que trae
 * WooCommerce de serie para España (`includes/i18n/states/ES.php`), así que
 * es la que hay en cualquier tienda que no la haya personalizado.
 */
const PROVINCIAS_ES: Readonly<Record<string, string>> = {
  C: "A Coruña",
  VI: "Araba/Álava",
  AB: "Albacete",
  A: "Alicante",
  AL: "Almería",
  O: "Asturias",
  AV: "Ávila",
  BA: "Badajoz",
  PM: "Baleares",
  B: "Barcelona",
  BU: "Burgos",
  CC: "Cáceres",
  CA: "Cádiz",
  S: "Cantabria",
  CS: "Castellón",
  CE: "Ceuta",
  CR: "Ciudad Real",
  CO: "Córdoba",
  CU: "Cuenca",
  GI: "Girona",
  GR: "Granada",
  GU: "Guadalajara",
  SS: "Gipuzkoa",
  H: "Huelva",
  HU: "Huesca",
  J: "Jaén",
  LO: "La Rioja",
  GC: "Las Palmas",
  LE: "León",
  L: "Lleida",
  LU: "Lugo",
  M: "Madrid",
  MA: "Málaga",
  ML: "Melilla",
  MU: "Murcia",
  NA: "Navarra",
  OR: "Ourense",
  P: "Palencia",
  PO: "Pontevedra",
  SA: "Salamanca",
  TF: "Santa Cruz de Tenerife",
  SG: "Segovia",
  SE: "Sevilla",
  SO: "Soria",
  T: "Tarragona",
  TE: "Teruel",
  TO: "Toledo",
  V: "Valencia",
  VA: "Valladolid",
  BI: "Bizkaia",
  ZA: "Zamora",
  Z: "Zaragoza",
};

/**
 * El nombre completo de la provincia, o el valor de entrada si no es un
 * código reconocido (texto ya completo, provincia de fuera de España, vacío).
 */
export function nombreProvincia(valor: string): string {
  const codigo = valor.trim().toUpperCase();
  return PROVINCIAS_ES[codigo] ?? valor;
}
