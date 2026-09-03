/**
 * Plantillas de correo: sustitución de variables.
 *
 * Lógica pura, sin base de datos ni red, para que se pueda probar sola. Lo que
 * decide esta función acaba en el buzón de un cliente, así que las dos cosas
 * que importan son que no se cuele HTML por una variable y que un error del
 * autor se vea antes de enviar, no después.
 */

/** Las claves que se pueden usar entre llaves dobles. */
export type Variables = Record<string, string | number | null | undefined>;

export type Renderizado = {
  texto: string;
  /** Variables escritas en la plantilla que no existen. Casi siempre, erratas. */
  desconocidas: string[];
  /** Variables que existen pero vienen sin valor en este envío concreto. */
  vacias: string[];
};

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sustituye {{variable}} por su valor.
 *
 * Una variable que no existe se deja tal cual y se informa. Borrarla en
 * silencio sería peor: nadie se entera de la errata y el correo sale cojo sin
 * que salte nada.
 *
 * `escaparHtml` es obligatorio para el cuerpo HTML. El nombre de un cliente
 * puede llevar `&` o `<`, y sin escapar rompe la maqueta en el mejor caso.
 */
export function renderizarPlantilla(
  plantilla: string,
  variables: Variables,
  opciones: { escaparHtml?: boolean } = {},
): Renderizado {
  const desconocidas = new Set<string>();
  const vacias = new Set<string>();

  const texto = plantilla.replace(VARIABLE, (coincidencia, clave: string) => {
    const nombre = clave.toLowerCase();
    if (!(nombre in variables)) {
      desconocidas.add(nombre);
      return coincidencia;
    }
    const valor = variables[nombre];
    if (valor === null || valor === undefined || String(valor).trim() === "") {
      vacias.add(nombre);
      return "";
    }
    const texto = String(valor);
    return opciones.escaparHtml ? escapar(texto) : texto;
  });

  return { texto, desconocidas: [...desconocidas], vacias: [...vacias] };
}

/** Las variables que la plantilla usa, sin repetir. */
export function variablesUsadas(plantilla: string): string[] {
  const encontradas = new Set<string>();
  for (const m of plantilla.matchAll(VARIABLE)) encontradas.add(m[1].toLowerCase());
  return [...encontradas];
}
