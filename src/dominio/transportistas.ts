/**
 * Los transportistas cuyo enlace de seguimiento se genera solo, a partir del
 * número de envío.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin red.
 *
 * ## Por qué esto no es solo una plantilla de texto
 *
 * Con CTT Express basta con meter el código en la URL. Con Nacex no: su
 * enlace lleva dos datos —agencia y albarán— y el número de envío que da
 * Nacex ya viene partido así, con una barra: `2111/10603971`. Aparte, «solo
 * poner el código en una plantilla» tienta a hacerlo con texto suelto en el
 * componente; aquí se prueba sin levantar ningún diálogo.
 */

/** Un transportista cuyo enlace se puede generar desde el número de envío. */
export type Transportista = {
  /** Como se guarda en `pedidos_tracking.transportista` y se enseña en pantalla. */
  nombre: string;
  /** Ejemplo de número de envío, para el campo del formulario. */
  marcador: string;
  /** Lo que se explica debajo del enlace generado. */
  ayuda: string;
  /** El enlace de seguimiento, o `null` si el código no da para generarlo. */
  urlSeguimiento: (codigo: string) => string | null;
};

function ctt(codigo: string): string | null {
  const limpio = codigo.trim();
  if (!limpio) return null;
  return `https://www.cttexpress.com/localizador-de-envios/?sc=${encodeURIComponent(limpio)}`;
}

export const CTT_EXPRESS: Transportista = {
  nombre: "CTT Express",
  marcador: "0034050034059700104370",
  ayuda: "Con CTT Express el enlace se genera solo desde el número de envío.",
  urlSeguimiento: ctt,
};

/**
 * La agencia de origen de Nacex de DTF Culture. Todos los envíos salen de
 * aquí, así que si el número de envío llega sin agencia —alguien escribe solo
 * el albarán— se asume esta.
 */
export const AGENCIA_NACEX_DTF_CULTURE = "2111";

function nacex(codigo: string): string | null {
  const partes = codigo
    .trim()
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;

  const [agencia, albaran] = partes.length >= 2 ? partes : [AGENCIA_NACEX_DTF_CULTURE, partes[0]];
  if (!albaran) return null;

  const parametros = new URLSearchParams({
    agencia_origen: agencia,
    numero_albaran: albaran,
    estado: "1",
    internacional: "0",
    externo: "N",
    usr: "null",
    pas: "null",
  });
  return `https://www.nacex.es/seguimientoDetalle.do?${parametros.toString()}`;
}

export const NACEX: Transportista = {
  nombre: "Nacex",
  marcador: `${AGENCIA_NACEX_DTF_CULTURE}/10603971`,
  ayuda:
    "Con Nacex el enlace se genera solo desde el número de envío, agencia/albarán. " +
    "Si escribes solo el albarán, se usa la agencia de DTF Culture (2111).",
  urlSeguimiento: nacex,
};

/** En el orden en que se ofrecen los botones del formulario de tracking. */
export const TRANSPORTISTAS_CONOCIDOS: readonly Transportista[] = [CTT_EXPRESS, NACEX];

/** El transportista conocido cuyo nombre coincide, o `null` si no hay ninguno. */
export function transportistaConocido(nombre: string): Transportista | null {
  const limpio = nombre.trim().toLowerCase();
  if (!limpio) return null;
  return TRANSPORTISTAS_CONOCIDOS.find((t) => t.nombre.toLowerCase() === limpio) ?? null;
}
