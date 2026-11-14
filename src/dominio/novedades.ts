/**
 * Novedades: lo que cambia en el CRM, contado para quien lo usa.
 *
 * Cada cambio que llega a la aplicación añade aquí su entrada, en el mismo
 * PR. Se escribe para un socio, no para un programador: qué puede hacer ahora
 * y dónde, en dos o tres líneas. Nada de nombres de tablas, migraciones ni
 * ficheros: `validarNovedad()` lo comprueba y la prueba falla si se cuela.
 *
 * Lo que cada persona ya ha visto se guarda en su dispositivo (como «¿Quién
 * eres?»): aquí solo la lista y las reglas.
 */

export type TipoNovedad = "nuevo" | "mejora" | "arreglo";

export const TIPOS_NOVEDAD: readonly { id: TipoNovedad; nombre: string; plural: string }[] = [
  { id: "nuevo", nombre: "Nuevo", plural: "Nuevo" },
  { id: "mejora", nombre: "Mejora", plural: "Mejoras" },
  { id: "arreglo", nombre: "Arreglo", plural: "Arreglos" },
];

export interface Novedad {
  /** Único y estable: es lo que se guarda como «visto». */
  id: string;
  /** Día en que llegó a la aplicación, 'yyyy-mm-dd'. */
  fecha: string;
  tipo: TipoNovedad;
  titulo: string;
  /** Una frase: qué cambia para ti. */
  resumen: string;
  /** De una a tres líneas cortas con el detalle. */
  puntos: string[];
  /** Adónde ir a verlo. */
  enlace?: { ruta: string; texto: string };
}

/** Lo más nuevo arriba. Cada PR añade la suya al principio. */
export const NOVEDADES: Novedad[] = [
  {
    id: "2026-11-14-cifras-corregidas",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Cifras corregidas",
    resumen: "Dos totales que salían más altos de lo real ya cuadran.",
    puntos: [
      "Cobros pendientes: no suma borradores y resta lo ya cobrado.",
      "Resumen de la tienda: sin cancelados y con todos los pedidos.",
      "Un ticket cambiado por factura ya no cuenta dos veces.",
    ],
    enlace: { ruta: "/panel/cobros", texto: "Ir a Cobros pendientes" },
  },
  {
    id: "2026-11-14-quiere-factura",
    fecha: "2026-11-14",
    tipo: "nuevo",
    titulo: "«Quiero factura» desde la web",
    resumen: "Si el cliente marca «Quiero factura» al comprar, el pedido lo recuerda.",
    puntos: [
      "Sale la etiqueta «Quiere factura» en el pedido.",
      "Filtra en Pedidos los que quieren factura.",
      "A esos pedidos no se les hace ticket, solo factura.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-14-novedades",
    fecha: "2026-11-14",
    tipo: "nuevo",
    titulo: "Novedades",
    resumen: "Aquí verás cada cambio del CRM, lo más nuevo arriba.",
    puntos: [
      "Un número en el menú te avisa de lo que aún no has visto.",
      "Cada cambio en dos o tres líneas, con un botón para ir a verlo.",
    ],
  },
  {
    id: "2026-11-12-agenda",
    fecha: "2026-11-12",
    tipo: "nuevo",
    titulo: "Agenda de tareas",
    resumen: "Un calendario con las tareas de cada socio.",
    puntos: [
      "Vista de día, semana, mes y año.",
      "Cada tarea con su prioridad y su color.",
      "Mándasela a otro socio: le sale un aviso en el menú.",
    ],
    enlace: { ruta: "/panel/agenda", texto: "Abrir la Agenda" },
  },
  {
    id: "2026-11-12-quien-eres",
    fecha: "2026-11-12",
    tipo: "nuevo",
    titulo: "«¿Quién eres?»",
    resumen: "Al entrar desde un móvil u ordenador nuevo, elige quién eres.",
    puntos: [
      "Se recuerda en ese dispositivo.",
      "Tu nombre sale arriba: tócalo para cambiar de persona.",
    ],
  },
  {
    id: "2026-11-12-seguridad",
    fecha: "2026-11-12",
    tipo: "mejora",
    titulo: "Más seguridad",
    resumen: "Cada usuario solo puede hacer lo que permite su nivel.",
    puntos: [
      "Leer presupuestos y compras con IA pide permiso para crear.",
      "Los datos de la empresa solo los ve quien tiene acceso.",
    ],
  },
  {
    id: "2026-11-11-dtf-uv",
    fecha: "2026-11-11",
    tipo: "mejora",
    titulo: "DTF UV con sus propias cifras",
    resumen: "El DTF y el DTF UV se ven por separado en toda la aplicación.",
    puntos: [
      "Ventas, margen y metros de cada uno por su lado.",
      "También en clientes, resumen diario y exportación.",
      "Pedidos manuales, presupuestos y correos ya los distinguen.",
    ],
    enlace: { ruta: "/panel/gerencia", texto: "Ver Gerencia" },
  },
  {
    id: "2026-11-10-uv-metros",
    fecha: "2026-11-10",
    tipo: "arreglo",
    titulo: "Metros y coste del DTF UV",
    resumen: "El DTF UV se reconoce y sus metros y su coste se cuentan bien.",
    puntos: ["Antes se sumaba a los metros del DTF normal."],
  },
  {
    id: "2026-11-06-vista-previa-factura",
    fecha: "2026-11-06",
    tipo: "nuevo",
    titulo: "Vista previa de la factura",
    resumen: "Antes de emitir una factura, la revisas y la corriges.",
    puntos: ["Cada factura puede llevar su propio método de pago."],
  },
  {
    id: "2026-11-06-boton-cobrado",
    fecha: "2026-11-06",
    tipo: "arreglo",
    titulo: "Botón «Cobrado»",
    resumen: "En Cobros pendientes, el botón «Cobrado» de Facturas ya funciona.",
    puntos: ["Marca la factura como pagada sin salir de la lista."],
    enlace: { ruta: "/panel/cobros", texto: "Ir a Cobros pendientes" },
  },
  {
    id: "2026-11-05-nif-web",
    fecha: "2026-11-05",
    tipo: "mejora",
    titulo: "El NIF llega solo desde la web",
    resumen: "El NIF o DNI que el cliente pone en la web llega al CRM.",
    puntos: [
      "Se guarda en la ficha del cliente si no lo tenía.",
      "Se queda en el pedido y se ve en su detalle.",
      "La factura lo usa sin tener que copiarlo.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
];

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

export const LIMITES_NOVEDAD = { titulo: 40, resumen: 90, punto: 80, puntos: 3 } as const;

/**
 * Palabras que no entiende un socio. Si una entrada las necesita, es que
 * está contando cómo se ha hecho y no qué cambia para quien lo usa.
 */
export const PALABRAS_TECNICAS = [
  "migración",
  "migracion",
  "rls",
  "supabase",
  "sql",
  "trigger",
  "commit",
  "pull request",
  "refactor",
  "endpoint",
  "servidor",
  "base de datos",
  "dominio",
  "componente",
  "prettier",
  "lint",
  "vitest",
  "typescript",
  "bug",
  "fix",
] as const;

/** Los problemas de una entrada; vacío si está bien. */
export function validarNovedad(n: Novedad): string[] {
  const errores: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.fecha) || Number.isNaN(Date.parse(`${n.fecha}T12:00:00Z`))) {
    errores.push("fecha no válida");
  }
  if (!n.id.startsWith(n.fecha)) errores.push("el id empieza por la fecha");
  if (!n.titulo.trim()) errores.push("sin título");
  if (n.titulo.length > LIMITES_NOVEDAD.titulo) errores.push("título largo");
  if (!n.resumen.trim()) errores.push("sin resumen");
  if (n.resumen.length > LIMITES_NOVEDAD.resumen) errores.push("resumen largo");
  if (n.puntos.length < 1 || n.puntos.length > LIMITES_NOVEDAD.puntos) {
    errores.push(`entre 1 y ${LIMITES_NOVEDAD.puntos} puntos`);
  }
  for (const p of n.puntos) {
    if (!p.trim()) errores.push("punto vacío");
    if (p.length > LIMITES_NOVEDAD.punto) errores.push(`punto largo: «${p}»`);
  }
  if (n.enlace && !n.enlace.ruta.startsWith("/panel")) errores.push("el enlace va a /panel");
  const texto = [n.titulo, n.resumen, ...n.puntos, n.enlace?.texto ?? ""].join(" ").toLowerCase();
  for (const palabra of PALABRAS_TECNICAS) {
    if (new RegExp(`(^|[^\\p{L}])${palabra}($|[^\\p{L}])`, "u").test(texto)) {
      errores.push(`palabra técnica: «${palabra}»`);
    }
  }
  return errores;
}

/** De más nueva a más antigua; a igual fecha, en el orden en que se escribieron. */
export function ordenarNovedades(lista: readonly Novedad[]): Novedad[] {
  return lista
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.fecha.localeCompare(a.n.fecha) || a.i - b.i)
    .map(({ n }) => n);
}

/** Agrupadas por día, en el orden de `ordenarNovedades`. */
export function novedadesPorDia(
  lista: readonly Novedad[],
): { fecha: string; novedades: Novedad[] }[] {
  const grupos: { fecha: string; novedades: Novedad[] }[] = [];
  for (const n of ordenarNovedades(lista)) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.fecha === n.fecha) ultimo.novedades.push(n);
    else grupos.push({ fecha: n.fecha, novedades: [n] });
  }
  return grupos;
}

/** Cuántas no ha visto esta persona en este dispositivo. */
export function cuantasSinVer(lista: readonly Novedad[], vistas: ReadonlySet<string>): number {
  return lista.filter((n) => !vistas.has(n.id)).length;
}

/**
 * Lee lo guardado como «visto». Cualquier cosa rara (vacío, JSON roto, otro
 * tipo) cuenta como nada visto, sin romper la pantalla.
 */
export function leerVistas(guardado: string | null): Set<string> {
  if (!guardado) return new Set();
  try {
    const v: unknown = JSON.parse(guardado);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Lo que se guarda al abrir Novedades: solo los ids que siguen existiendo,
 * para que no crezca para siempre.
 */
export function guardarVistas(lista: readonly Novedad[]): string {
  return JSON.stringify(lista.map((n) => n.id));
}
