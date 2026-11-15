/**
 * Qué receptor y qué líneas lleva la factura que se genera desde un pedido
 * con un solo botón.
 *
 * Lógica pura: no importa nada de `routes/`, de Supabase ni hace ninguna
 * llamada de red, y se prueba sin base de datos.
 *
 * ## De dónde sale el receptor
 *
 * La ficha de cliente es la fuente fiscal buena: si el pedido tiene un
 * cliente vinculado con nombre, ese cliente manda entero. Solo se cae a la
 * dirección del pedido cuando no hay cliente vinculado —un pedido de
 * invitado, o uno manual sin ficha—.
 *
 * El NIF tiene además su copia en el pedido (`pedidos.cliente_nif`, el que
 * trajo WooCommerce en `_billing_nif`). Se usa cuando la ficha no tiene NIF o
 * no hay ficha; si la ficha tiene uno, gana la ficha, que puede estar
 * corregida a mano. Sin ninguno de los dos, se deja en blanco.
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

import { calcularTotales, redondear } from "./importes";
import { diaEnEspana } from "./fecha-documento";

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
 * facturación guardada. `nifCongelado` es `pedidos.cliente_nif`.
 */
export function receptorDesdePedido(
  cliente: ClienteFiscal | null,
  direccion: DireccionPedido | null,
  clienteNombreCongelado: string | null,
  clienteEmailCongelado: string | null,
  nifCongelado: string | null = null,
): ReceptorFactura {
  const nifPedido = nifCongelado?.trim() || null;
  if (cliente?.nombre?.trim()) {
    return {
      nombre: cliente.nombre.trim(),
      nif: cliente.nif?.trim() || nifPedido,
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
    nif: nifPedido,
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

// ---------------------------------------------------------------------------
// Devoluciones: líneas en negativo
// ---------------------------------------------------------------------------

/**
 * Una devolución del pedido, como está en `pedido_devoluciones`: un reembolso
 * de la web (`woo_refund_id`) o una rebaja del importe real (sin él, con su
 * motivo). El importe lleva IVA, como el total del pedido.
 */
export type DevolucionParaDocumento = {
  importe: number | string | null;
  motivo?: string | null;
  woo_refund_id?: number | string | null;
  /** Instante (ISO) del reembolso o de la rebaja. */
  fecha?: string | null;
};

/** 'yyyy-mm-dd' → 'dd/mm/yyyy'. */
function diaLegible(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

function descripcionDevolucion(dev: DevolucionParaDocumento): string {
  if (dev.woo_refund_id != null && dev.woo_refund_id !== "") {
    const instante = dev.fecha ? new Date(dev.fecha) : null;
    return instante && !Number.isNaN(instante.getTime())
      ? `Devolución del ${diaLegible(diaEnEspana(instante))}`
      : "Devolución";
  }
  return dev.motivo?.trim() || "Rebaja";
}

/**
 * Las líneas en negativo que descuentan las devoluciones de un pedido de las
 * líneas de su documento.
 *
 * Decisión de Javier (15-11-2026): si un pedido tiene devoluciones cuando se
 * factura, el documento sale con sus líneas de siempre y, debajo, una línea
 * en negativo por cada devolución, y suma lo que el cliente pagó al final
 * (cobrado 15,72 €, devuelto 7,25 € → 8,47 €).
 *
 * El importe de la devolución lleva IVA. Se reparte entre los tipos de IVA
 * del pedido en proporción a lo que pesa cada uno (casi siempre hay uno
 * solo, el 21 %), y cada parte se pasa a base. Como el IVA del documento se
 * calcula sobre la base sumada de cada tipo, al final se cuadra al céntimo:
 * el total del documento es exactamente el de las líneas menos lo devuelto.
 *
 * Las devoluciones a 0 (una rebaja quitada) no generan línea.
 */
export function lineasDeDevoluciones(
  lineas: readonly LineaFactura[],
  devoluciones: readonly DevolucionParaDocumento[] | null | undefined,
): LineaFactura[] {
  const devs = (devoluciones ?? [])
    .map((d) => ({ d, importe: redondear(Number(d.importe) || 0) }))
    .filter((x) => x.importe > 0);
  if (devs.length === 0) return [];

  const totales = calcularTotales(lineas);
  const porTipo = totales.desglose_iva
    .map((t) => ({ tipo: t.tipo, bruto: redondear(t.base + t.cuota) }))
    .filter((t) => t.bruto > 0);
  const brutoTotal = redondear(porTipo.reduce((s, t) => s + t.bruto, 0));
  if (brutoTotal <= 0) return [];

  const nuevas: LineaFactura[] = [];
  for (const { d, importe } of devs) {
    let repartido = 0;
    porTipo.forEach((t, i) => {
      const parte =
        i === porTipo.length - 1
          ? redondear(importe - repartido)
          : redondear((importe * t.bruto) / brutoTotal);
      repartido = redondear(repartido + parte);
      if (parte <= 0) return;
      const base = redondear(parte / (1 + t.tipo / 100));
      nuevas.push({
        descripcion:
          porTipo.length > 1
            ? `${descripcionDevolucion(d)} (IVA ${t.tipo} %)`
            : descripcionDevolucion(d),
        cantidad: 1,
        unidad: "ud",
        precio_unitario: -base,
        iva_rate: t.tipo,
      });
    });
  }

  // Al céntimo: el IVA va sobre la base sumada de cada tipo, así que pasar
  // cada parte a base puede dejar el total a uno o dos céntimos. Se corrige
  // la base de la primera línea de devolución, la que más pesa, buscando la
  // que deja el total más cerca. Casi siempre cuadra exacto; hay totales con
  // IVA a los que ninguna base llega (al 21 %, 146,04 €: 120,69 € da 146,03 y
  // 120,70 € da 146,05) y entonces queda a un céntimo.
  const devuelto = redondear(devs.reduce((s, x) => s + x.importe, 0));
  const objetivo = redondear(totales.total - devuelto);
  if (nuevas.length > 0) {
    const original = nuevas[0].precio_unitario;
    let mejor = original;
    let menor = Infinity;
    for (const paso of [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03]) {
      nuevas[0].precio_unitario = redondear(original + paso);
      const diferencia = Math.abs(calcularTotales([...lineas, ...nuevas]).total - objetivo);
      if (diferencia < menor - 1e-9) {
        menor = diferencia;
        mejor = nuevas[0].precio_unitario;
      }
      if (diferencia < 1e-9) break;
    }
    nuevas[0].precio_unitario = mejor;
  }
  return nuevas;
}

/** Lo devuelto de un pedido (con IVA): la suma de sus devoluciones. */
export function totalDevuelto(
  devoluciones: readonly DevolucionParaDocumento[] | null | undefined,
): number {
  return redondear((devoluciones ?? []).reduce((s, d) => s + (Number(d.importe) || 0), 0));
}

/**
 * ¿El ticket o la factura de un pedido suma más de lo que pagó el cliente,
 * porque hubo una devolución (o una rebaja) después de emitirlo? Para la
 * lista de pedidos: allí se compara con el total del pedido, que puede
 * diferir del de sus líneas en algún céntimo de redondeo, así que se pide
 * al menos 5 céntimos de diferencia. La comprobación exacta la hace la
 * preparación del documento, con sus líneas.
 */
export function documentoDescuadrado(
  totalDocumento: number | null | undefined,
  totalPedido: number | string | null | undefined,
  devuelto: number,
): boolean {
  if (totalDocumento == null || !(devuelto > 0)) return false;
  const real = redondear((Number(totalPedido) || 0) - devuelto);
  return redondear(Number(totalDocumento) - real) >= 0.05;
}
