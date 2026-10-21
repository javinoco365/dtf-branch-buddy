/**
 * El mapa de la aplicación: cómo se agrupa el menú y cómo se llama cada
 * pantalla.
 *
 * Una sola fuente para la barra lateral y la cabecera: el nombre que sale en el
 * menú es el mismo que sale arriba al entrar en la pantalla. Antes cada sitio
 * tenía el suyo («Pedidos Consolidados» en el menú, «Pedidos consolidados» en
 * la pantalla) y el menú era una lista de doce entradas sin orden de tarea.
 *
 * Los grupos van por lo que se hace, no por cómo está montada la base:
 * vender (pedidos, clientes, productos), el dinero (lo que se debe, lo cobrado,
 * lo que se paga, banco, caja, archivo), cada tienda, el textil y los ajustes.
 *
 * Los iconos son de la interfaz: aquí solo va su nombre.
 */

export type ClaveIcono =
  | "inicio"
  | "gerencia"
  | "pedidos"
  | "clientes"
  | "productos"
  | "cobros"
  | "cobrado"
  | "compras"
  | "banco"
  | "caja"
  | "inversion"
  | "archivo"
  | "presupuestos"
  | "facturas"
  | "facturacion"
  | "ajustes"
  | "usuarios"
  | "tiendas"
  | "stock"
  | "compras-textil";

export interface EntradaMenu {
  ruta: string;
  etiqueta: string;
  icono: ClaveIcono;
  /**
   * También activa en las rutas que empiezan igual: Gerencia con sus
   * pestañas, Ajustes con «Datos de la empresa», «Caja», «PDF»…
   */
  prefijo?: boolean;
  soloAdmin?: boolean;
}

export interface SeccionMenu {
  /** Sin título, el primer grupo: lo que se abre cada día. */
  titulo: string | null;
  entradas: EntradaMenu[];
}

export const MENU_PRINCIPAL: SeccionMenu[] = [
  {
    titulo: null,
    entradas: [
      { ruta: "/panel", etiqueta: "Inicio", icono: "inicio" },
      { ruta: "/panel/gerencia", etiqueta: "Gerencia", icono: "gerencia", prefijo: true },
    ],
  },
  {
    titulo: "Ventas",
    entradas: [
      { ruta: "/panel/pedidos", etiqueta: "Pedidos", icono: "pedidos" },
      { ruta: "/panel/clientes", etiqueta: "Clientes", icono: "clientes" },
      { ruta: "/panel/productos", etiqueta: "Productos", icono: "productos" },
    ],
  },
  {
    titulo: "Dinero",
    entradas: [
      { ruta: "/panel/cobros", etiqueta: "Cobros pendientes", icono: "cobros" },
      { ruta: "/panel/facturacion-global", etiqueta: "Lo cobrado", icono: "cobrado" },
      { ruta: "/panel/compras", etiqueta: "Facturas de compra", icono: "compras" },
      { ruta: "/panel/conciliacion", etiqueta: "Conciliación bancaria", icono: "banco" },
      { ruta: "/panel/caja", etiqueta: "Caja", icono: "caja" },
      { ruta: "/panel/inversion", etiqueta: "Inversión", icono: "inversion" },
      { ruta: "/panel/archivo", etiqueta: "Archivo", icono: "archivo" },
    ],
  },
];

/**
 * Las pantallas de cada tienda, colgando de `/panel/tiendas/<id>`. El segmento
 * vacío es su resumen (`/panel/tiendas/<id>`).
 */
export const SUBMENU_TIENDA: { segmento: string; etiqueta: string; icono: ClaveIcono }[] = [
  { segmento: "", etiqueta: "Resumen", icono: "inicio" },
  { segmento: "pedidos", etiqueta: "Pedidos", icono: "pedidos" },
  { segmento: "presupuestos", etiqueta: "Presupuestos", icono: "presupuestos" },
  { segmento: "facturas", etiqueta: "Facturas", icono: "facturas" },
  { segmento: "facturacion", etiqueta: "Facturación", icono: "facturacion" },
  { segmento: "productos", etiqueta: "Productos", icono: "productos" },
  { segmento: "clientes", etiqueta: "Clientes", icono: "clientes" },
  { segmento: "ajustes", etiqueta: "Ajustes", icono: "ajustes" },
];

export const ENTRADA_GESTIONAR_TIENDAS: EntradaMenu = {
  ruta: "/panel/tiendas",
  etiqueta: "Gestionar tiendas",
  icono: "tiendas",
};

/** El módulo textil: su resumen y sus pantallas. */
export const SUBMENU_TEXTIL: EntradaMenu[] = [
  { ruta: "/panel/textil", etiqueta: "Resumen", icono: "inicio" },
  { ruta: "/panel/textil/stock", etiqueta: "Stock", icono: "stock", prefijo: true },
  { ruta: "/panel/textil/compras", etiqueta: "Compras", icono: "compras-textil", prefijo: true },
  { ruta: "/panel/textil/pedidos", etiqueta: "Pedidos", icono: "pedidos", prefijo: true },
  {
    ruta: "/panel/textil/presupuestos",
    etiqueta: "Presupuestos",
    icono: "presupuestos",
    prefijo: true,
  },
  { ruta: "/panel/textil/facturas", etiqueta: "Facturas", icono: "facturas", prefijo: true },
  { ruta: "/panel/textil/clientes", etiqueta: "Clientes", icono: "clientes", prefijo: true },
  { ruta: "/panel/textil/ajustes", etiqueta: "Ajustes", icono: "ajustes", prefijo: true },
];

export const MENU_SISTEMA: EntradaMenu[] = [
  { ruta: "/panel/configuracion", etiqueta: "Ajustes", icono: "ajustes", prefijo: true },
  { ruta: "/panel/usuarios", etiqueta: "Usuarios", icono: "usuarios", soloAdmin: true },
];

/** Las subpantallas de Ajustes, que no salen en el menú pero sí arriba. */
const SUBPANTALLAS_AJUSTES: Record<string, string> = {
  "/panel/configuracion-empresa": "Datos de la empresa",
  "/panel/configuracion-caja": "Caja",
  "/panel/configuracion-pdf": "PDF de presupuestos",
};

/** Si una entrada del menú corresponde a la pantalla abierta. */
export function entradaActiva(entrada: EntradaMenu, pathname: string): boolean {
  const ruta = quitarBarraFinal(pathname);
  if (ruta === entrada.ruta) return true;
  return !!entrada.prefijo && ruta.startsWith(entrada.ruta);
}

export interface PantallaActual {
  /** El grupo o la tienda: «Dinero», «Tienda Uno», «Textil». */
  seccion: string | null;
  /** El nombre de la pantalla, el mismo que en el menú. */
  titulo: string;
}

/**
 * Dónde está el usuario, para la cabecera: «Dinero › Lo cobrado»,
 * «Tienda Uno › Facturas». `null` si la ruta no es del panel.
 *
 * El nombre de la tienda lo pone quien llama (sale de la base); sin él, se
 * dice «Tienda».
 */
export function pantallaActual(
  pathname: string,
  nombreTienda?: string | null,
): PantallaActual | null {
  const ruta = quitarBarraFinal(pathname);

  const tienda = ruta.match(/^\/panel\/tiendas\/([^/]+)(?:\/([^/]+))?$/);
  if (tienda) {
    const seccion = nombreTienda?.trim() || "Tienda";
    const segmento = tienda[2] ?? "";
    const sub = SUBMENU_TIENDA.find((s) => s.segmento === segmento);
    return { seccion, titulo: sub?.etiqueta ?? capitalizar(segmento) };
  }

  if (ruta === "/panel/textil" || ruta.startsWith("/panel/textil/")) {
    // La más larga primero: «/panel/textil» también empieza todas las demás.
    const sub = [...SUBMENU_TEXTIL]
      .sort((a, b) => b.ruta.length - a.ruta.length)
      .find((e) => entradaActiva(e, ruta));
    return { seccion: "Textil", titulo: sub?.etiqueta ?? "Textil" };
  }

  if (SUBPANTALLAS_AJUSTES[ruta]) return { seccion: "Ajustes", titulo: SUBPANTALLAS_AJUSTES[ruta] };

  if (entradaActiva(ENTRADA_GESTIONAR_TIENDAS, ruta)) {
    return { seccion: "Tiendas", titulo: ENTRADA_GESTIONAR_TIENDAS.etiqueta };
  }

  for (const s of MENU_PRINCIPAL) {
    const e = s.entradas.find((x) => entradaActiva(x, ruta));
    if (e) return { seccion: s.titulo, titulo: e.etiqueta };
  }
  for (const e of MENU_SISTEMA) {
    if (entradaActiva(e, ruta)) return { seccion: "Sistema", titulo: e.etiqueta };
  }
  return null;
}

function quitarBarraFinal(ruta: string): string {
  return ruta.length > 1 && ruta.endsWith("/") ? ruta.slice(0, -1) : ruta;
}

function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
