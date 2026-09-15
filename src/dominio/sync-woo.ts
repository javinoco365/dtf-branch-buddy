/**
 * Lo que decide la sincronización con WooCommerce cuando un pedido ya no
 * está donde estaba: borrado en la tienda, o devuelto en parte o del todo.
 *
 * Lógica pura: no importa nada de `routes/`, de Supabase ni hace ninguna
 * llamada de red, y se prueba sin ninguna de las dos.
 *
 * ## Por qué el borrado se limita a la fecha del pedido más antiguo de la página
 *
 * La sincronización trae los últimos 100 pedidos de WooCommerce, no todos.
 * Comparar «qué hay en el CRM» contra «qué ha traído Woo» sin más borraría
 * cualquier pedido antiguo que se haya quedado fuera de esos 100 —no porque
 * lo hayan borrado, sino porque hay más de 100 pedidos nuevos por delante—.
 *
 * La solución: solo se compara contra los pedidos del CRM cuya fecha cae
 * dentro del tramo que Woo acaba de traer. Un pedido de hace un año nunca
 * entra en esa comparación, así que nunca se borra por estar fuera de la
 * página. Uno de la semana pasada sí entra, y si no aparece en lo que Woo
 * acaba de devolver es que ha desaparecido de verdad.
 */

/** Lo mínimo de un pedido de WooCommerce que hace falta para estas cuentas. */
export type PedidoWooResumen = {
  id: number;
  date_created?: string | null;
  /** Los reembolsos vienen ya en la propia respuesta de `/orders`. */
  refunds?: { total?: string | number | null }[] | null;
};

/** Los ids de WooCommerce que ha traído esta página de la sincronización. */
export function idsVistosWoo(pedidos: readonly PedidoWooResumen[]): Set<number> {
  return new Set(pedidos.map((p) => p.id));
}

/**
 * La fecha del pedido más antiguo de la página, o `null` si viene vacía.
 *
 * La API los devuelve ordenados por fecha descendente, así que es el
 * último de la lista — pero no se confía en el orden: se calcula el mínimo
 * de verdad, por si algún día cambia el `orderby` de la consulta.
 */
export function fechaMasAntigua(pedidos: readonly PedidoWooResumen[]): string | null {
  const fechas = pedidos.map((p) => p.date_created).filter((f): f is string => !!f);
  if (fechas.length === 0) return null;
  return fechas.reduce((min, f) => (f < min ? f : min));
}

/** Un pedido del CRM, lo mínimo para decidir si sigue estando en Woo. */
export type PedidoCrmResumen = { id: string; woo_order_id: number };

/**
 * Los pedidos del CRM que ya no aparecen entre los que acaba de traer Woo.
 *
 * Quien llama es responsable de pasar solo candidatos dentro del tramo de
 * fechas que cubre `pedidosWoo` — ver el porqué arriba. Esta función no lo
 * comprueba: no tiene con qué, no conoce fechas del lado del CRM.
 */
export function pedidosDesaparecidos(
  candidatosCrm: readonly PedidoCrmResumen[],
  pedidosWoo: readonly PedidoWooResumen[],
): PedidoCrmResumen[] {
  const vistos = idsVistosWoo(pedidosWoo);
  return candidatosCrm.filter((p) => !vistos.has(p.woo_order_id));
}

/**
 * Lo que se ha devuelto de un pedido, sumando sus reembolsos.
 *
 * WooCommerce guarda el importe de un reembolso en negativo (es un ajuste a
 * la baja), así que se toma en valor absoluto. Un reembolso sin importe
 * numérico se ignora en vez de romper la cuenta de todos los demás.
 */
export function totalReembolsado(refunds: unknown): number {
  if (!Array.isArray(refunds)) return 0;
  return refunds.reduce((suma: number, rf) => {
    const n = Number((rf as { total?: unknown } | null)?.total);
    return Number.isFinite(n) ? suma + Math.abs(n) : suma;
  }, 0);
}

/** A cuánto hay que dejar `estado_pago`, o `null` si no hay nada que cambiar. */
export type EstadoPagoDevolucion = "reembolsado" | "parcial";

/**
 * Si lo devuelto cubre el pedido entero, parte de él, o nada.
 *
 * Un céntimo de margen (`EPSILON`) porque el total del pedido y la suma de
 * sus reembolsos son dos cálculos distintos en WooCommerce y un redondeo de
 * un céntimo no debe dejar un pedido devuelto del todo marcado como parcial
 * para siempre.
 */
const EPSILON = 0.01;

export function estadoPagoPorDevolucion(
  totalPedido: number,
  reembolsado: number,
): EstadoPagoDevolucion | null {
  if (!(reembolsado > 0)) return null;
  return reembolsado >= totalPedido - EPSILON ? "reembolsado" : "parcial";
}

/**
 * Qué clientes de invitado hay que dar de alta a partir de una tanda de
 * pedidos.
 *
 * ## El problema
 *
 * La sincronización solo traía fichas de cliente de `/wp-json/wc/v3/customers`,
 * que es la lista de cuentas registradas en WooCommerce. Un pedido de
 * invitado —sin cuenta, sin `customer_id`— nunca aparece ahí. El pedido en sí
 * se guardaba bien, con el nombre y el email congelados en sus propias
 * columnas, pero no dejaba ninguna ficha en Clientes: ese comprador
 * desaparecía de la base de clientes en cuanto se cerraba el pedido, y si
 * volvía a comprar, otra vez sin ficha.
 *
 * ## Por qué el correo es la clave, no el nombre
 *
 * Un invitado no tiene ningún identificador estable salvo lo que escribió en
 * el formulario. El correo es lo único de eso que de verdad identifica a la
 * misma persona entre dos pedidos —el nombre se teclea distinto de una vez a
 * otra, con o sin tilde, con o sin el segundo apellido—.
 */
export type PedidoWooBilling = {
  customer_id?: number | null;
  billing?: {
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    address_1?: string | null;
    address_2?: string | null;
    city?: string | null;
    state?: string | null;
    postcode?: string | null;
    country?: string | null;
  } | null;
};

/** Una ficha de cliente nueva, lista para insertar. */
export type ClienteInvitadoNuevo = {
  nombre: string;
  email: string;
  telefono: string | null;
  empresa: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string;
};

function limpio(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Los invitados de esta tanda que todavía no tienen ficha.
 *
 * `emailsConFicha` son los correos que ya existen como cliente en esta
 * tienda, en minúsculas: tanto los de cuentas registradas como los de un
 * invitado de una sincronización anterior. Un correo de ahí nunca genera una
 * ficha nueva, aunque el pedido sea de invitado.
 *
 * Dentro de la propia tanda, un correo repetido —dos pedidos de invitado del
 * mismo comprador el mismo día— solo genera una ficha: la segunda vez
 * chocaría al intentar insertar la misma fila dos veces en la misma
 * escritura.
 */
export function clientesInvitadosNuevos(
  orders: readonly PedidoWooBilling[],
  emailsConFicha: ReadonlySet<string>,
): ClienteInvitadoNuevo[] {
  const vistos = new Set<string>();
  const nuevos: ClienteInvitadoNuevo[] = [];

  for (const o of orders) {
    if (o.customer_id) continue;
    const b = o.billing;
    const emailOriginal = b?.email?.trim();
    if (!emailOriginal) continue;
    const email = emailOriginal.toLowerCase();
    if (vistos.has(email) || emailsConFicha.has(email)) continue;
    vistos.add(email);

    const nombre = [limpio(b?.first_name), limpio(b?.last_name)].filter(Boolean).join(" ");
    const direccion = [limpio(b?.address_1), limpio(b?.address_2)].filter(Boolean).join(" ");

    nuevos.push({
      nombre: nombre || emailOriginal,
      email: emailOriginal,
      telefono: limpio(b?.phone),
      empresa: limpio(b?.company),
      direccion: direccion || null,
      codigo_postal: limpio(b?.postcode),
      ciudad: limpio(b?.city),
      provincia: limpio(b?.state),
      pais: limpio(b?.country) ?? "ES",
    });
  }

  return nuevos;
}
