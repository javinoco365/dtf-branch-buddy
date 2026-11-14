/**
 * Errores para personas.
 *
 * La mayoría de los errores de la app ya vienen en castellano y pensados para
 * quien la usa: los escriben las server functions y las funciones de la base
 * («Tu nivel no permite borrar», «La factura ya está registrada…»). Esos se
 * dejan tal cual.
 *
 * Los que no: los que llegan de más abajo (el navegador, PostgREST, Postgres,
 * Supabase Auth), en inglés y en jerga: «Failed to fetch», «new row violates
 * row-level security policy», «duplicate key value violates unique
 * constraint». Esos se traducen a lo que le pasa a quien está delante y qué
 * puede hacer, y el texto original queda como detalle, para quien tenga que
 * mirarlo.
 */

export interface ErrorLegible {
  /** Lo que se le dice a la persona. */
  texto: string;
  /** El mensaje original, si se ha traducido: para quien tenga que mirarlo. */
  detalle: string | null;
}

type Regla = { patron: RegExp; texto: string | ((m: RegExpMatchArray) => string) };

/**
 * Supabase Auth: el acceso, las contraseñas y los enlaces. Van antes que las
 * generales porque algunos («Auth session missing») se parecen a otras.
 */
const REGLAS_ACCESO: Regla[] = [
  {
    patron: /invalid login credentials|invalid_credentials/i,
    texto: "El correo o la contraseña no son correctos.",
  },
  {
    patron: /email not confirmed|email_not_confirmed/i,
    texto: "Aún no has confirmado tu correo. Busca el enlace que te llegó y vuelve a intentarlo.",
  },
  {
    patron: /user (?:is )?banned|user_banned/i,
    texto: "Este usuario está desactivado. Habla con un administrador.",
  },
  {
    patron: /you can only request this after (\d+) seconds?/i,
    texto: (m) => `Por seguridad, espera ${m[1]} segundos antes de volver a intentarlo.`,
  },
  {
    patron: /rate limit|too many requests|over_[a-z_]*rate_limit/i,
    texto: "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
  },
  {
    patron: /password should be at least (\d+) characters?/i,
    texto: (m) => `La contraseña es demasiado corta: tiene que tener al menos ${m[1]} caracteres.`,
  },
  {
    patron: /new password should be different|same_password/i,
    texto: "La contraseña nueva tiene que ser distinta de la que ya tenías.",
  },
  {
    patron:
      /password is known to be weak|weak_password|pwned|password should contain at least one character|password is too weak/i,
    texto:
      "Esa contraseña es demasiado fácil de adivinar. Usa una más larga, con letras, números y algún símbolo.",
  },
  {
    patron: /user already registered|already been registered|email_exists|user_already_exists/i,
    texto: "Ya hay un usuario con ese correo.",
  },
  {
    patron: /user not found|user_not_found/i,
    texto: "No hay ningún usuario con ese correo.",
  },
  {
    patron: /unable to validate email address|email_address_invalid|invalid email/i,
    texto: "El correo no está bien escrito.",
  },
  {
    patron: /signups? not allowed|signup_disabled/i,
    texto: "El alta está cerrada: el acceso es solo por invitación.",
  },
  {
    patron:
      /token has expired or is invalid|link is invalid or has expired|otp_expired|flow_state_expired/i,
    texto: "El enlace ha caducado o ya se ha usado. Pide otro a un administrador.",
  },
];

/** PostgREST y Postgres, lo que no es de permisos ni de restricciones. */
const REGLAS_BASE: Regla[] = [
  {
    patron:
      /could not find the (?:table|function|column)|schema cache|PGRST20[25]|(?:relation|function|column) \S+ does not exist|(?:code|código|sqlstate)\W{0,4}(?:42P01|42883|42703)/i,
    texto: "Esta parte aún no está activada. Avisa a Javier.",
  },
  {
    patron: /JSON object requested, multiple \(or no\) rows returned|PGRST116/i,
    texto: "No se ha encontrado: puede que lo haya borrado otra persona. Recarga la página.",
  },
  {
    patron: /value too long for type|(?:code|código|sqlstate)\W{0,4}22001/i,
    texto: "Algún texto es demasiado largo. Acórtalo y vuelve a intentarlo.",
  },
  {
    patron: /numeric field overflow|out of range for type|(?:code|código|sqlstate)\W{0,4}22003/i,
    texto: "Alguna cifra es demasiado grande. Revisa lo que has escrito.",
  },
  {
    patron: /payload too large|request entity too large|maximum allowed size/i,
    texto: "El fichero es demasiado grande.",
  },
];

const REGLAS_GENERALES: Regla[] = [
  {
    patron: /failed to fetch|networkerror|load failed|network request failed|fetch failed/i,
    texto: "No hay conexión con el servidor. Comprueba internet y vuelve a intentarlo.",
  },
  {
    patron: /jwt expired|invalid jwt|refresh token|session (?:not found|expired|missing)/i,
    texto: "La sesión ha caducado. Sal y vuelve a entrar.",
  },
  {
    patron: /row-level security|permission denied|(?:code|código|sqlstate)\W{0,4}42501/i,
    texto: "No tienes permiso para hacer esto. Si crees que deberías, habla con un administrador.",
  },
  {
    patron: /duplicate key|(?:code|código|sqlstate)\W{0,4}23505/i,
    texto: "Ya existe uno igual: está repetido.",
  },
  {
    patron: /foreign key|(?:code|código|sqlstate)\W{0,4}23503/i,
    texto: "No se puede: hay otros datos que dependen de este.",
  },
  {
    patron: /not-null constraint|null value in column|(?:code|código|sqlstate)\W{0,4}23502/i,
    texto: "Falta un dato obligatorio.",
  },
  {
    patron: /check constraint|(?:code|código|sqlstate)\W{0,4}23514|invalid input (?:syntax|value)/i,
    texto: "Algún dato no tiene un valor válido. Revisa lo que has escrito.",
  },
  {
    patron: /timed out|timeout|gateway time-?out|canceling statement/i,
    texto: "El servidor ha tardado demasiado en responder. Vuelve a intentarlo.",
  },
  {
    patron: /internal server error|bad gateway|service unavailable/i,
    texto: "Ha fallado algo en el servidor. Vuelve a intentarlo y, si se repite, avisa.",
  },
  {
    patron: /unexpected token|is not valid json|json\.parse/i,
    texto: "El servidor ha respondido algo inesperado. Vuelve a intentarlo.",
  },
];

/**
 * El texto para la persona. `porDefecto` es lo que se dice si no hay mensaje
 * (un error vacío o que no es un Error).
 */
export function errorParaPersonas(
  mensaje: string | null | undefined,
  porDefecto = "No se ha podido completar. Vuelve a intentarlo.",
): ErrorLegible {
  const original = (mensaje ?? "").trim();
  if (!original) return { texto: porDefecto, detalle: null };
  // Un error de validación (zod) llega como la lista de fallos en JSON: se
  // cuenta en frases. El JSON no se enseña ni como detalle.
  const validacion = errorDeValidacion(original);
  if (validacion) return { texto: validacion, detalle: null };
  for (const regla of REGLAS) {
    const m = original.match(regla.patron);
    if (m) {
      const texto = typeof regla.texto === "string" ? regla.texto : regla.texto(m);
      return { texto, detalle: original };
    }
  }
  return { texto: original, detalle: null };
}

const REGLAS: Regla[] = [...REGLAS_ACCESO, ...REGLAS_BASE, ...REGLAS_GENERALES];

// ── Errores de validación (zod) ──────────────────────────────────────────────

/** Cómo se dice cada campo en una frase, y si es femenino. */
const CAMPOS: Record<string, [string, boolean]> = {
  nombre: ["el nombre", false],
  full_name: ["el nombre completo", false],
  cliente_nombre: ["el nombre del cliente", false],
  cliente_email: ["el correo del cliente", false],
  cliente_telefono: ["el teléfono del cliente", false],
  cliente_id: ["el cliente", false],
  email: ["el correo", false],
  password: ["la contraseña", true],
  clave: ["la contraseña", true],
  telefono: ["el teléfono", false],
  nif: ["el NIF o CIF", false],
  cif: ["el CIF", false],
  direccion: ["la dirección", true],
  codigo_postal: ["el código postal", false],
  ciudad: ["la ciudad", true],
  provincia: ["la provincia", true],
  pais: ["el país", false],
  fecha: ["la fecha", true],
  desde: ["la fecha de inicio", true],
  hasta: ["la fecha de fin", true],
  descripcion: ["la descripción", true],
  concepto: ["el concepto", false],
  cantidad: ["la cantidad", true],
  unidades_por_pack: ["las unidades por paquete", true],
  precio_unitario: ["el precio unitario", false],
  precio_venta: ["el precio de venta", false],
  importe: ["el importe", false],
  total: ["el total", false],
  iva_rate: ["el IVA", false],
  iva_pct: ["el IVA", false],
  metodo_pago: ["la forma de pago", true],
  tienda_id: ["la tienda", true],
  proveedor_id: ["el proveedor", false],
  proveedor: ["el proveedor", false],
  producto_id: ["el producto", false],
  pedido_id: ["el pedido", false],
  factura_id: ["la factura", true],
  socio_id: ["el socio", false],
  marca: ["la marca", true],
  marca_id: ["la marca", true],
  categoria: ["la categoría", true],
  referencia: ["la referencia", true],
  sku: ["la referencia (SKU)", true],
  talla: ["la talla", true],
  color: ["el color", false],
  unidad: ["la unidad", true],
  tipo: ["el tipo", false],
  estado: ["el estado", false],
  motivo: ["el motivo", false],
  notas: ["las notas", true],
  observaciones: ["las observaciones", true],
  texto: ["el texto", false],
  lineas: ["las líneas", true],
  items: ["las líneas", true],
  numero: ["el número", false],
  ejercicio: ["el año", false],
  transportista: ["el transportista", false],
  woo_url: ["la dirección de la tienda", true],
  logo_url: ["la dirección del logotipo", true],
  validez_dias: ["los días de validez", false],
};

interface FalloValidacion {
  code?: string;
  path: (string | number)[];
  message: string;
  origin?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  inclusive?: boolean;
  expected?: string;
  input?: unknown;
}

/** Los mensajes que zod escribe por su cuenta, en inglés. */
const MENSAJE_ZOD_INGLES =
  /^(?:invalid|too (?:small|big)|expected|required|string must|number must|array must|unrecognized)/i;

function esFallo(x: unknown): x is FalloValidacion {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<FalloValidacion>;
  return Array.isArray(f.path) && typeof f.message === "string";
}

function leerFallos(mensaje: string): FalloValidacion[] | null {
  const ini = mensaje.indexOf("[");
  const fin = mensaje.lastIndexOf("]");
  if (ini < 0 || fin <= ini) return null;
  try {
    const datos: unknown = JSON.parse(mensaje.slice(ini, fin + 1));
    if (!Array.isArray(datos) || datos.length === 0 || !datos.every(esFallo)) return null;
    return datos;
  } catch {
    return null;
  }
}

function mayuscula(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Cómo se dice el campo: «el nombre del cliente», «la fecha (línea 2)». */
function nombreCampo(ruta: (string | number)[]): [string, boolean] {
  const claves = ruta.filter((p): p is string => typeof p === "string");
  const indices = ruta.filter((p): p is number => typeof p === "number");
  const ultima = claves[claves.length - 1];
  let base: [string, boolean];
  if (!ultima) base = ["un dato", false];
  else if (CAMPOS[ultima]) base = CAMPOS[ultima];
  else base = [`el campo «${ultima.replace(/_id$/, "").replace(/_/g, " ")}»`, false];
  if (indices.length === 0) return base;
  return [`${base[0]} (línea ${indices[indices.length - 1] + 1})`, base[1]];
}

function cifra(n: number | undefined): string {
  return n === undefined ? "" : String(n).replace(".", ",");
}

function fraseDeFallo(f: FalloValidacion): string {
  const mensaje = f.message.trim();
  // Un mensaje propio del esquema («Pon el nombre») ya está pensado para personas.
  if (mensaje && !MENSAJE_ZOD_INGLES.test(mensaje)) return mensaje;
  const [campo, fem] = nombreCampo(f.path);
  const Campo = mayuscula(campo);
  const valido = fem ? "válida" : "válido";
  const falta = /received (?:undefined|null)|required/i.test(mensaje);
  switch (f.code) {
    case "invalid_type":
      if (falta) return `Falta ${campo}.`;
      if (f.expected === "number") return `${Campo} tiene que ser un número.`;
      if (f.expected === "date") return `${Campo} no es una fecha ${valido}.`;
      return `${Campo} no es ${valido}.`;
    case "too_small":
      if (f.origin === "string") {
        return Number(f.minimum) <= 1
          ? `Falta ${campo}.`
          : `${Campo} tiene que tener al menos ${cifra(f.minimum)} caracteres.`;
      }
      if (f.origin === "array" || f.origin === "set") {
        return Number(f.minimum) <= 1
          ? `${Campo} no puede ir ${fem ? "vacía" : "vacío"}: añade al menos una.`
          : `${Campo} necesita al menos ${cifra(f.minimum)}.`;
      }
      return f.inclusive === false
        ? `${Campo} tiene que ser mayor que ${cifra(f.minimum)}.`
        : `${Campo} tiene que ser como mínimo ${cifra(f.minimum)}.`;
    case "too_big":
      if (f.origin === "string")
        return `${Campo} es demasiado ${fem ? "larga" : "largo"}: como mucho ${cifra(f.maximum)} caracteres.`;
      if (f.origin === "array" || f.origin === "set")
        return `${Campo} admite como mucho ${cifra(f.maximum)}.`;
      return f.inclusive === false
        ? `${Campo} tiene que ser menor que ${cifra(f.maximum)}.`
        : `${Campo} no puede pasar de ${cifra(f.maximum)}.`;
    case "invalid_format":
    case "invalid_string":
      if (f.format === "email") return `${Campo} no es un correo ${valido}.`;
      if (f.format === "uuid" || f.format === "guid") return `Falta elegir ${campo}.`;
      if (f.format === "url") return `${Campo} no es una dirección web ${valido}.`;
      if (f.format && /date|time/.test(f.format)) return `${Campo} no es una fecha ${valido}.`;
      return `${Campo} no tiene el formato correcto.`;
    case "invalid_value":
    case "invalid_enum_value":
      return `${Campo} no tiene un valor permitido.`;
    default:
      return falta ? `Falta ${campo}.` : `${Campo} no es ${valido}.`;
  }
}

/**
 * Un error de validación de zod, en frases: «Falta el nombre del cliente.».
 * Devuelve null si el mensaje no es una lista de fallos de zod.
 */
export function errorDeValidacion(mensaje: string): string | null {
  const fallos = leerFallos(mensaje);
  if (!fallos) return null;
  const frases = [...new Set(fallos.map(fraseDeFallo))];
  const mostradas = frases.slice(0, 3);
  const resto = frases.length - mostradas.length;
  return mostradas.join(" ") + (resto > 0 ? ` Y ${resto} cosa${resto === 1 ? "" : "s"} más.` : "");
}

/**
 * Lo que le pasó a la lectura de una factura, para la persona. El lector
 * guarda su error técnico («El lector de facturas ha respondido 400 (tras un
 * reintento)», «La lectura no tiene la forma esperada: confianza está fuera de
 * rango»); en la cola se dice qué hacer.
 */
export function errorLecturaParaPersonas(mensaje: string): ErrorLegible {
  const original = mensaje.trim();
  if (/facturas_key|anthropic_api_key|vault|secreto|no está configurado/i.test(original)) {
    return {
      texto: "La lectura automática no está activada: da esta factura de alta a mano.",
      detalle: original,
    };
  }
  if (/forma esperada|fuera de rango|no es del tipo|no es un valor permitido/i.test(original)) {
    return {
      texto: "La lectura salió incompleta. Vuelve a leerla (↻) o dala de alta a mano.",
      detalle: original,
    };
  }
  if (/ha respondido|sin código|reintento/i.test(original)) {
    return {
      texto: "El lector no ha podido con este fichero. Vuelve a leerlo (↻) o dalo de alta a mano.",
      detalle: original,
    };
  }
  return errorParaPersonas(original);
}
