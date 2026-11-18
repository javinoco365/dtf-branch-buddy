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
    id: "2026-11-18-recargo-aparte-del-iva",
    fecha: "2026-11-18",
    tipo: "mejora",
    titulo: "El R.E, aparte del IVA",
    resumen: "En el pedido salen el IVA y el recargo de equivalencia por separado.",
    puntos: [
      "Un pedido con R.E enseña, por ejemplo, IVA 2,73 € y R.E 0,67 €.",
      "Los pedidos antiguos con R.E se marcan con «Recuperar recargo», en Ajustes.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-18-recargo-equivalencia",
    fecha: "2026-11-18",
    tipo: "nuevo",
    titulo: "Recargo de equivalencia (R.E)",
    resumen:
      "Si la web cobró recargo de equivalencia, el pedido lleva «R.E» y su factura lo suma sola.",
    puntos: [
      "La etiqueta «R.E» sale al lado de «Factura», y hay un filtro «Con R.E».",
      "A esos pedidos no se les hace ticket: solo factura, con el 5,2 % debajo del IVA.",
      "La etiqueta «Quiere factura» ahora pone solo «Factura».",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-15-facturas-con-devoluciones",
    fecha: "2026-11-15",
    tipo: "mejora",
    titulo: "Facturas y tickets con las devoluciones",
    resumen: "El documento de un pedido devuelto en parte suma lo que pagó el cliente.",
    puntos: [
      "Salen las líneas del pedido y, debajo, la devolución en negativo.",
      "Si devolviste después de facturar, el pedido avisa con «Corregir».",
      "Te guía: rectificativa que lo anula y documento nuevo por lo pagado.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-15-devuelto-en-pedidos",
    fecha: "2026-11-15",
    tipo: "mejora",
    titulo: "Las devoluciones de la web, a la vista",
    resumen: "Un pedido con reembolso en WooCommerce lleva la etiqueta «Devuelto».",
    puntos: [
      "Sale junto al cliente, con el importe devuelto, también en pedidos cancelados.",
      "Lo cobrado ya descontaba el reembolso; ahora además se ve.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-15-nombres-sencillos",
    fecha: "2026-11-15",
    tipo: "mejora",
    titulo: "Cifras con nombres más sencillos",
    resumen:
      "Cada cifra se llama igual en todas las pantallas, como en la Facturación de la tienda.",
    puntos: [
      "«Ventas netas» ahora es «Facturación bruta», y hay un solo «Margen».",
      "«Beneficio», «Por cobrar», «Por pagar» y «Envíos cobrados», sin jerga.",
      "Cuando importa, el nombre dice si lleva IVA o no.",
    ],
  },
  {
    id: "2026-11-15-facturacion-tienda-como-antes",
    fecha: "2026-11-15",
    tipo: "mejora",
    titulo: "Facturación de la tienda, como estaba",
    resumen: "La pantalla Facturación de cada tienda vuelve a su versión anterior.",
    puntos: [
      "Arriba: Vendido, Facturación bruta, Cobrado, Pedidos y Ticket medio.",
      "Abajo: Bruta, Envíos cobrados, IVA y Total, y el botón «Exportar CSV».",
      "Vendido lleva IVA y envío; los pedidos de la web sin pagar cuentan, como antes.",
    ],
  },
  {
    id: "2026-11-15-quiere-factura-en-cliente",
    fecha: "2026-11-15",
    tipo: "arreglo",
    titulo: "«Quiere factura», junto al cliente",
    resumen: "La etiqueta ya no tapa el número de pedido.",
    puntos: ["Sale en la caja del cliente, al lado de «1.er pedido», en ordenador y en móvil."],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-14-importe-real",
    fecha: "2026-11-14",
    tipo: "nuevo",
    titulo: "Ajustar el importe real de un pedido",
    resumen: "Si la venta real no es el total (sin envío, precio acordado), lo dices tú.",
    puntos: [
      "Toca «Parcial» o «Cobros» del pedido y pulsa «Ajustar importe».",
      "Botones rápidos: «Sin envío» y «Lo cobrado». Pide un motivo.",
      "Baja la venta y lo pendiente; la web no se toca.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-14-hoy-con-lista",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "«Hoy»: toca una cifra y ve sus pedidos",
    resumen: "Por producir, por enviar y por cobrar abren la lista de esos pedidos.",
    puntos: [
      "Con número, cliente, tienda, estado e importe.",
      "Toca un pedido para ir a él en su lista.",
    ],
    enlace: { ruta: "/panel", texto: "Ir a Inicio" },
  },
  {
    id: "2026-11-14-pendientes-sin-cancelados",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Pendientes sin pedidos cancelados",
    resumen: "Un pedido cancelado ya no cuenta como deuda en ningún sitio.",
    puntos: [
      "Ni en pedidos pendientes de cobro ni en el total pendiente.",
      "Tampoco la factura de un pedido cancelado en Cobros pendientes.",
    ],
    enlace: { ruta: "/panel/cobros", texto: "Ir a Cobros pendientes" },
  },
  {
    id: "2026-11-14-textil-sin-ropa",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Textil sin ropa: margen exacto",
    resumen: "Un pedido textil sin prendas del almacén ya no sale como estimado.",
    puntos: [
      "Si en el pedido marcas una prenda, lleva ropa; si no, no.",
      "Solo falta coste si la prenda marcada aún no ha salido del almacén.",
    ],
    enlace: { ruta: "/panel/cuenta-resultados", texto: "Ver la Cuenta de resultados" },
  },
  {
    id: "2026-11-14-web-sin-pagar-no-cuenta",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "No pagado no es venta, en todas partes",
    resumen: "Gerencia ya no cuenta nunca los pedidos de la web sin pagar.",
    puntos: [
      "Salen en el aviso de Gerencia y cuentan en cuanto se pagan.",
      "Se quita de Ajustes de Gerencia el interruptor que los contaba.",
      "En Cobros pendientes, uno con algo cobrado dice «Web (pago parcial)».",
    ],
    enlace: { ruta: "/panel/gerencia", texto: "Abrir Gerencia" },
  },
  {
    id: "2026-11-14-mismas-ventas-netas",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Las mismas ventas netas en todas partes",
    resumen: "Lo facturado sin pedido es venta también en Inicio, en cada tienda y en Gerencia.",
    puntos: [
      "En Inicio, la gráfica es «Ventas netas por día»: sin IVA y con el textil.",
      "Gerencia › Resumen calcula ventas netas, margen y ticket con canal o A/B.",
      "Al separar la cuenta, las columnas suman justo el total, sin céntimos sueltos.",
    ],
    enlace: { ruta: "/panel", texto: "Ir a Inicio" },
  },
  {
    id: "2026-11-14-sociedades-y-variacion",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Impuesto y comparaciones más fieles",
    resumen: "Sociedades resta todas las devoluciones de lo documentado y se ve por periodo.",
    puntos: [
      "Separando por mes, el impuesto sale solo en el total: es del periodo entero.",
      "De pérdidas a beneficio ya no sale un porcentaje raro: dice «antes en pérdidas».",
      "Cada devolución de la web se guarda con su fecha real, no la de sincronizar.",
    ],
    enlace: { ruta: "/panel/cuenta-resultados", texto: "Abrir la cuenta" },
  },
  {
    id: "2026-11-14-pedidos-con-cuidado",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Pedidos: menos sustos",
    resumen: "El formulario avisa de cifras raras y la web no cambia sin preguntarte.",
    puntos: [
      "El IVA de una línea solo puede ser 21, 10, 4 o 0.",
      "«1.500» o una línea de más de 10.000 € piden confirmar la cifra leída.",
      "Cambiar el estado de un pedido de la web, o reabrir uno cancelado, se confirma.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-14-sociedades-documentado",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Sociedades, solo sobre lo documentado",
    resumen: "La Cuenta de resultados estima el impuesto solo sobre lo que tiene factura o ticket.",
    puntos: [
      "Lo vendido sin factura ni ticket no entra en el impuesto.",
      "Los gastos, solo los que tienen justificante.",
      "Es una estimación: el de verdad lo calcula la gestoría.",
    ],
    enlace: { ruta: "/panel/cuenta-resultados", texto: "Abrir la cuenta" },
  },
  {
    id: "2026-11-14-cuenta-mas-fiel",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Cuenta de resultados más fiel",
    resumen: "Tres casos en que las cifras de la cuenta no eran las de verdad.",
    puntos: [
      "Mirando solo DTF UV, un pedido solo de DTF ya no cuenta ni resta su envío.",
      "Sin coste por metro en Ajustes, el margen sale como estimado, no inflado.",
      "Lo facturado sin pedido suma también en «Ventas con IVA» y en «IVA».",
    ],
    enlace: { ruta: "/panel/cuenta-resultados", texto: "Abrir la cuenta" },
  },
  {
    id: "2026-11-14-mas-claro",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Más claro en toda la app",
    resumen: "Los mismos nombres, dibujos y colores en todas partes, también en modo oscuro.",
    puntos: [
      "Cada pantalla se llama igual que en el menú; cada cifra, con su dibujo.",
      "Si una lista sale vacía, tienes a mano «Quitar filtros» o «Nuevo».",
      "Desde Pedidos creas un pedido de cualquier tienda, eligiéndola antes.",
    ],
    enlace: { ruta: "/panel/pedidos", texto: "Ver pedidos" },
  },
  {
    id: "2026-11-14-mas-comodo-en-el-movil",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Más cómodo en el móvil",
    resumen: "Botones más fáciles de tocar y ventanas que no esconden «Guardar».",
    puntos: [
      "«Ir» en el teclado del móvil guarda pedidos, cobros, apuntes y fichas.",
      "La X de cerrar y el menú, del tamaño de un dedo.",
      "Tarjetas más juntas y tablas que se leen sin desplazarse de lado.",
    ],
  },
  {
    id: "2026-11-14-inicio-hoy",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Inicio: lo de hoy, arriba",
    resumen: "Al entrar ves cuántos pedidos hay por producir, enviar y cobrar, y tus tareas.",
    puntos: [
      "Toca cada número para ir a su pantalla.",
      "Debajo, del periodo: ventas netas, margen bruto, cobrado y pendiente de cobro.",
      "Las mismas cifras, con el mismo nombre, en el resumen de cada tienda.",
    ],
    enlace: { ruta: "/panel", texto: "Ir a Inicio" },
  },
  {
    id: "2026-11-14-cuenta-resultados",
    fecha: "2026-11-14",
    tipo: "nuevo",
    titulo: "Cuenta de resultados",
    resumen: "De lo que pagan los clientes a lo que le queda a la empresa, en una tabla.",
    puntos: [
      "Compara con el periodo anterior y separa por tienda, línea o mes.",
      "Cada cifra con su explicación; lo estimado, marcado.",
      "Sustituye a las pestañas Margen y Resultados de Gerencia.",
    ],
    enlace: { ruta: "/panel/cuenta-resultados", texto: "Abrir la cuenta" },
  },
  {
    id: "2026-11-14-nada-sin-querer",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Nada se pierde ni se hace sin querer",
    resumen: "Lo que avisa al cliente o no tiene vuelta atrás se confirma antes.",
    puntos: [
      "Enviado o cancelado pregunta antes; si el correo o la web fallan, se avisa.",
      "Cerrar un pedido, ficha, apunte o tarea a medias pregunta antes de descartarlo.",
      "Al crear un pedido la ventana se cierra: no se crea dos veces.",
    ],
  },
  {
    id: "2026-11-14-textos-claros",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Avisos y textos más claros",
    resumen: "Los avisos y errores salen en castellano llano y dicen qué hacer.",
    puntos: [
      "Si una lista no carga, dice por qué y deja reintentar, en vez de salir vacía.",
      "Un número que no se entiende se dice; ya no se guarda como 0.",
      "«Aún no está activada» solo sale cuando de verdad falta algo por activar.",
    ],
  },
  {
    id: "2026-11-14-agenda-arreglos",
    fecha: "2026-11-14",
    tipo: "mejora",
    titulo: "Agenda más cómoda",
    resumen: "Cada día del calendario tiene su botón «+» y en el móvil tocar un día abre ese día.",
    puntos: [
      "«Hoy» cambia solo a medianoche y el verde de «Realizada» se lee mejor.",
      "Sin persona asignada no se crean tareas: el botón dice por qué.",
      "En «Para» y «De» solo salen los socios que usan el CRM.",
    ],
    enlace: { ruta: "/panel/agenda", texto: "Abrir la Agenda" },
  },
  {
    id: "2026-11-14-cifras-corregidas",
    fecha: "2026-11-14",
    tipo: "arreglo",
    titulo: "Cifras corregidas",
    resumen: "Tres totales que salían más altos de lo real ya cuadran.",
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
