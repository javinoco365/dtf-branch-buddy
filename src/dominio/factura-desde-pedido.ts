/**
 * Qué receptor y qué líneas lleva la factura que se genera desde un pedido
 * con un solo botón.
 *
 * Lógica pura: no importa nada de `routes/`, de Supabase ni hace ninguna
 * llamada de red, y se prueba sin base de datos.
 *
 * ## De dónde sale el receptor
 *
 * La ficha de cliente es la fuente fiscal buena: es donde vive el NIF, y es
 * el único sitio que lo tiene. La dirección congelada en el pedido —lo que
 * trae WooCommerce en `billing`— no incluye NIF en ningún caso: el
 * formulario de compra no lo pide.
 *
 * Por eso, si el pedido tiene un cliente vinculado con nombre, ese cliente
 * manda entero. Solo se cae a la dirección del pedido cuando no hay cliente
 * vinculado —un pedido de invitado, o uno manual sin ficha—, y ahí no hay
 * NIF que poner: se deja en blanco y que se vea, en vez de dejarlo vacío sin
 * decir por qué.
 *
 * ## Por qué `empresa` gana a `nombre` en la dirección del pedido
 *
 * `direccionWoo()` guarda el nombre de quien compra (`first_name` +
 * `last_name`) y, aparte, la empresa si la escribió. En una venta B2B la
 * factura va a nombre de la empresa, no de la persona que rellenó el
 * formulario.
 *
 * ## Por qué el envío se convierte en una línea
 *
 * `pedidos.envio` es una columna aparte, no una línea de `pedido_items` —
 * `calcularTotales()` lo suma a la base imponible al vuelo, al 21 %, sin que
 * exista como línea propia en ningún sitio. Una factura no tiene ese atajo:
 * lo que no es una línea no se factura. Se añade aquí, con el mismo tipo que
 * usa `calcularTotales()`, para que el total de la factura coincida con el
 * del pedido.
 */

const IVA_GENERAL = 21;

/** La dirección de facturación congelada en el pedido. Todo opcional. */
export type DireccionPedido = {
  nombre?: string | null;
  empresa?: string | null;
  direccion?: string | null;
  codigo_postal?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  email?: string | null;
};

/** Los datos fiscales de la ficha de cliente. `nombre` es lo único que hace falta. */
export type ClienteFiscal = {
  nombre: string;
  nif?: string | null;
  direccion?: string | null;
  codigo_postal?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  email?: string | null;
};

/** El receptor tal como lo espera `emitirFactura()`. */
export type ReceptorFactura = {
  nombre: string;
  nif: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string | null;
  email: string | null;
};

/**
 * El receptor de la factura: la ficha de cliente si existe, o la dirección
 * del pedido si no.
 *
 * `clienteNombreCongelado` / `clienteEmailCongelado` son el último recurso:
 * lo que guardó la sincronización directamente en el pedido
 * (`pedidos.cliente_nombre` / `cliente_email`), para el caso —raro, pero
 * posible— de un pedido sin cliente vinculado y sin dirección de
 * facturación guardada.
 */
export function receptorDesdePedido(
  cliente: ClienteFiscal | null,
  direccion: DireccionPedido | null,
  clienteNombreCongelado: string | null,
  clienteEmailCongelado: string | null,
): ReceptorFactura {
  if (cliente?.nombre?.trim()) {
    return {
      nombre: cliente.nombre.trim(),
      nif: cliente.nif?.trim() || null,
      direccion: cliente.direccion?.trim() || null,
      codigo_postal: cliente.codigo_postal?.trim() || null,
      ciudad: cliente.ciudad?.trim() || null,
      provincia: cliente.provincia?.trim() || null,
      pais: cliente.pais?.trim() || null,
      email: cliente.email?.trim() || null,
    };
  }

  const d = direccion ?? {};
  return {
    nombre: d.empresa?.trim() || d.nombre?.trim() || clienteNombreCongelado?.trim() || "",
    nif: null,
    direccion: d.direccion?.trim() || null,
    codigo_postal: d.codigo_postal?.trim() || null,
    ciudad: d.ciudad?.trim() || null,
    provincia: d.provincia?.trim() || null,
    pais: d.pais?.trim() || null,
    email: d.email?.trim() || clienteEmailCongelado?.trim() || null,
  };
}

/** Una línea del pedido, lo mínimo que hace falta para facturarla. */
export type ItemPedido = {
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
  precio_unitario: number;
  iva_rate?: number | null;
};

/** Una línea de factura, tal como la espera `emitirFactura()`. */
export type LineaFactura = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
};

/**
 * Las líneas de la factura: las del pedido, más el envío si lo llevaba.
 *
 * El 21 % en una línea sin tipo es el mismo respaldo que usa el formulario
 * de pedido manual: pasa en pedidos de antes de que `iva_rate` existiera.
 */
export function lineasDesdePedido(
  items: readonly ItemPedido[],
  gastosEnvio: number,
): LineaFactura[] {
  const lineas: LineaFactura[] = items.map((it) => ({
    descripcion: it.descripcion,
    cantidad: Number(it.cantidad),
    unidad: it.unidad?.trim() || "m",
    precio_unitario: Number(it.precio_unitario),
    iva_rate: it.iva_rate == null ? IVA_GENERAL : Number(it.iva_rate),
  }));

  if (gastosEnvio > 0) {
    lineas.push({
      descripcion: "Gastos de envío",
      cantidad: 1,
      unidad: "ud",
      precio_unitario: gastosEnvio,
      iva_rate: IVA_GENERAL,
    });
  }

  return lineas;
}
