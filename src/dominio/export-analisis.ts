/**
 * La exportación de pedidos para análisis: un fichero que se explica solo,
 * pensado para dárselo a Claude (o a cualquier analista) y que pueda comprobar
 * las cuentas sin abrir el CRM.
 *
 * Lleva, además de los pedidos con sus líneas, qué significa cada campo, cómo
 * se calcula y un resumen por mes y tienda. Cada pedido se calcula con las
 * reglas de las pantallas (baseConEnvio, parteVendida, costeProduccion,
 * resumenCobros, documentoVigente) y se redondea al céntimo; el resumen es la
 * suma de los pedidos, así que cuadra con ellos al céntimo. Con las pantallas
 * coincide salvo céntimos y lo que dice `diferencias_con_las_pantallas` del
 * LEEME.
 *
 * Lógica pura: recibe las filas ya leídas.
 */

import {
  ESTADO_CANCELADO,
  baseConEnvio,
  costeProduccion,
  parteVendida,
  type PedidoResumen,
} from "./kpis";
import { resumenCobros } from "./cobros";
import { fechaDocumentoDePedido } from "./fecha-documento";
import { redondear } from "./importes";
import { esEstimado } from "./metros-woo";
import { documentoVigente } from "./tickets";

export const FORMATO_EXPORT_ANALISIS = "dtf-crm/analisis-pedidos/1";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export type PedidoExport = PedidoResumen & {
  id: string;
  numero?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  estado_pago?: string | null;
  estado_produccion?: string | null;
  estado_envio?: string | null;
  metodo_pago?: string | null;
  cancelado_en?: string | null;
  motivo_cancelacion?: string | null;
};

export type LineaExport = {
  pedido_id: string;
  descripcion?: string | null;
  cantidad?: number | string | null;
  unidad?: string | null;
  precio_unitario?: number | string | null;
  iva_rate?: number | string | null;
  subtotal?: number | string | null;
  iva?: number | string | null;
  metros_origen?: string | null;
  precio_metro_usado?: number | string | null;
  coste_unit_snapshot?: number | string | null;
};

export type CobroExport = {
  pedido_id: string;
  fecha?: string | null;
  importe: number | string | null;
  propina?: number | string | null;
  metodo?: string | null;
};

export type DocumentoExport = {
  id: string;
  pedido_id: string;
  tipo?: string | null;
  referencia: string;
  fecha?: string | null;
  estado?: string | null;
  base_imponible?: number | string | null;
  iva_total?: number | string | null;
  total?: number | string | null;
  fecha_vencimiento?: string | null;
  rectifica_a_id?: string | null;
  sustituye_a_id?: string | null;
};

export type CostesMetro = { consumibles: number; packaging: number; electricidad: number };

/** Lo de Ajustes de Gerencia que cambia cómo se leen las cifras. */
export type AjustesExport = {
  /** Precio por metro sin IVA con el que se estiman los metros sin longitud. */
  precio_metro: number;
  /** Si los pedidos web sin pagar cuentan como venta en Gerencia. */
  web_sin_pagar_cuenta: boolean;
  /** true si no hay ajustes guardados y son los de fábrica. */
  de_fabrica: boolean;
};

/** Lo que el fichero explica de sí mismo. Se lee antes que los datos. */
export const LEEME_ANALISIS = {
  proposito:
    "Pedidos de DTF por metros de las tiendas de DTI S.L. (RONOCA DESARROLLOS S.L.), exportados del CRM para comprobaciones económicas: precio real del metro, márgenes, envíos, devoluciones, cobros y documentos fiscales. Todos los pedidos de todas las fechas del alcance indicado; no lleva el textil, las facturas de compra ni los gastos fijos.",
  moneda: "EUR. Importes redondeados al céntimo; metros con 3 decimales.",
  fechas:
    "`fecha` es el día del pedido: en los de WooCommerce, el de la hora de la web; en los manuales, el de la hora de España. Es el día que llevan su ticket o su factura. `mes` (yyyy-mm) sale de esa fecha.",
  definiciones: {
    origen:
      "'woocommerce' (pedido de la tienda online, sincronizado) o 'manual' (dado de alta en el CRM).",
    estado:
      "Columna antigua que el CRM mantiene a partir de los tres estados de abajo: pendiente, en_produccion, imprimiendo, listo, enviado, entregado, cancelado. En los pedidos web, 'pendiente' es el «pendiente de pago» o «en espera» de WooCommerce (ver web_sin_pagar); en los manuales, que no se ha empezado. Solo 'cancelado' cambia las cifras.",
    estado_pago:
      "pendiente, parcial, pagado o reembolsado. En los manuales, 'parcial' es un anticipo; en los web, un reembolso parcial, y 'reembolsado', uno total. Para el dinero mandan los cobros, no este campo.",
    estado_produccion: "sin_empezar, en_cola, imprimiendo o listo (impreso y empaquetado).",
    estado_envio: "sin_enviar, preparado, en_transito, entregado o devuelto.",
    cancelado:
      "Pedido cancelado (también los fallidos y los reembolsados enteros de WooCommerce). cancelado_en y motivo_cancelacion dicen cuándo y por qué, si consta.",
    web_sin_pagar:
      "Pedido web en estado 'pendiente': en WooCommerce, sin pagar o en espera (una transferencia que no ha llegado o un pago abandonado). Cuenta como venta y como pendiente de cobro, como en las pantallas, pero se da aparte en el resumen.",
    metodo_pago:
      "Lo que eligió el cliente en un pedido manual; en los web suele venir vacío. El medio real de cada cobro está en cobros.lista[].metodo.",
    base: "Base imponible del pedido, con el envío dentro. base + iva = total (si no, ver `descuadre`).",
    envio: "Envío cobrado al cliente, sin IVA. Va dentro de la base, no de la bruta.",
    bruta:
      "Lo vendido sin IVA y sin envío (base − envío), sin descontar devoluciones. Incluye lo que no va en metros (camisetas, diseños…) si el pedido lo lleva.",
    iva: "IVA repercutido del pedido.",
    total: "Lo que paga el cliente: base + IVA (envío incluido).",
    descuadre:
      "total − base − iva. Cero en un pedido sano; si no, el pedido se guardó con importes que no cuadran y conviene revisarlo.",
    devuelto:
      "Reembolsos de WooCommerce, con IVA, tal como los da la web. Un reembolso total convierte el pedido en cancelado.",
    parte_vendida:
      "Qué parte del pedido sigue vendida después de devoluciones: (total − devuelto) ÷ total, entre 0 y 1. WooCommerce no dice qué líneas se devolvieron, así que se reparte en proporción.",
    netos:
      "base_neta, envio_neto, iva_neto y total_neto son los importes × parte_vendida, redondeados por pedido; bruta_neta = base_neta − envio_neto. La «Facturación bruta» de las pantallas es la suma de bruta_neta. En los cancelados son 0: no cuentan como venta. base_neta + iva_neto puede diferir de total_neto en 0,01 por el redondeo.",
    metros:
      "Metros lineales del pedido (pedidos.metros_total). Los cancelados también lo traen, pero no suman en el resumen. Las devoluciones no los descuentan: lo impreso, impreso está. Ver `metros_de`.",
    metros_de:
      "'lineas_medidas' (WooCommerce: suma de las líneas en metros, unidad 'm') o 'suma_de_cantidades' (pedidos manuales: el CRM guarda todas sus líneas en 'ud', aunque sean metros, y suma las cantidades de TODAS; si el pedido lleva algo que no es metros, sus metros, su coste y su €/m están mal y no se puede saber qué línea corregir salvo por la descripción).",
    metros_estimados:
      "true si alguna línea no trae la longitud del montador de DTFBuild y sus metros se estimaron como subtotal ÷ precio por metro (metros_origen 'precio_ajustes' o 'precio_linea'); metros_de_lineas_estimadas dice cuántos. En esas líneas el €/m es el precio usado por construcción, y la longitud del montador también se descarta y se estima si da un precio fuera de 0,5–1,5 veces el de Ajustes. Por eso los metros mal leídos aparecen como estimados, no como un €/m extremo.",
    metros_origen:
      "En cada línea: 'montador' (longitud leída del montador), 'precio_linea' o 'precio_ajustes' (estimada), o null (sin dato: líneas que no van en metros o anteriores a guardar el origen; null no garantiza que se midiera).",
    venta_metros:
      "La parte de la bruta que corresponde a las líneas en metros (en proporción a los subtotales de las líneas, para repartir cupones). En los pedidos sin líneas en metros, la bruta entera.",
    eur_metro:
      "Precio de venta del metro del pedido: venta_metros ÷ metros, sin IVA, sin envío y sin descontar devoluciones. null en los cancelados y en los que no tienen metros.",
    coste_metro:
      "Coste estándar de producción por metro (consumibles + embalaje + electricidad, configurado en Ajustes; no es un coste medido) que se guardó con el pedido. Los pedidos que ya estaban en el CRM antes del 7-10-2026 llevan el del día en que se aplicó esa migración, no el de su fecha. Si no hay ninguno guardado, el de hoy (coste_metro_es_actual = true).",
    coste_produccion:
      "metros × coste_metro; 0 en los cancelados. No incluye el envío ni el coste de lo que no va en metros.",
    margen_estimado:
      "bruta_neta − coste_produccion. Estimación: no incluye gastos fijos, sueldos, comisiones de cobro, el coste de lo que no va en metros ni el de enviar por agencia un pedido sin cobrar envío (el CRM no lo conoce).",
    cobros:
      "Dinero recibido por el pedido. cobrado es la suma de los importes; pendiente = total_neto − cobrado (negativo si se cobró de más). La propina va aparte (propinas y lista[].propina): no es del pedido, pero llega al banco junto con el importe. En los cancelados el estado es 'cancelado' y el pendiente 0, aunque tengan cobros (dinero de un pedido que no se vendió).",
    "cobros.lista[].metodo":
      "efectivo, tarjeta, transferencia, web o sin_especificar. 'web' es el cobro automático de la tienda online: no dice si se pagó con tarjeta, Bizum o transferencia, ya va neto de reembolsos y lleva la fecha del pedido (en hora de España), no la del pago.",
    documentos:
      "Tickets ('simplificada'), facturas ('ordinaria') y rectificativas ('rectificativa') del pedido. estado: emitida, pagada, vencida o anulada ('pagada' o 'vencida' no dicen nada del cobro: para eso, los cobros). Una rectificativa corrige a la que señala rectifica_a; la de una anulación lleva los importes en negativo. Un canje es una factura que sustituye a un ticket (sustituye_a) por el mismo importe: no se suman los dos. Los ids son los de esos documentos.",
    documento_vigente:
      "La referencia del documento que cuenta para el pedido (la factura o el ticket que no esté anulado, rectificado ni sustituido), o null si no tiene ninguno.",
    lineas:
      "subtotal es sin IVA (en WooCommerce, antes de cupones; el pedido ya los descuenta). iva es el IVA real de la línea; iva_pct es el tipo guardado, que en los pedidos web siempre es 21 aunque el IVA real sea otro. coste_unit es el coste congelado por unidad de la línea (0 en las que no van en 'm').",
    resumen_mensual:
      "Una fila por mes y tienda: sumas de los pedidos de ese mes (por la fecha del pedido) que no están cancelados, salvo los campos *_cancelados. Cuadra al céntimo con la suma de sus pedidos. `cobrado` son los cobros de los pedidos del mes, se cobraran cuando se cobraran; `cobrado_por_fecha_de_cobro` son los cobros con fecha en ese mes, de pedidos de cualquier mes (también cancelados), que es lo que enseñan las pantallas como «Cobrado». Precio del metro: `eur_metro` = Σ venta_metros ÷ Σ metros; `eur_metro_medido`, lo mismo solo con los pedidos web sin metros estimados, que es el precio real más fiable; `eur_metro_neto` = bruta_neta ÷ metros de los pedidos con metros, la cifra «€/metro» de Gerencia.",
    totales: "Lo mismo que una fila del resumen, para todo el fichero.",
  },
  reglas: [
    "Los pedidos cancelados no cuentan en ventas, metros, costes ni pendiente: van aparte (cancelados, importe_cancelados, devuelto_cancelados, cobrado_cancelados).",
    "Los importes y costes de cada pedido son los que se guardaron con él; no se recalculan con los precios de hoy. Excepción: cada sincronización vuelve a escribir los últimos 100 pedidos web, y sus metros estimados se recalculan con el precio por metro de Ajustes de ese momento.",
    "No hay datos de contacto de los clientes (ni email, ni teléfono, ni dirección): solo su id y su nombre.",
  ],
  diferencias_con_las_pantallas: [
    "Las cifras usan las reglas de las pantallas (Dashboard, Facturación, Gerencia) y coinciden con ellas salvo céntimos: aquí se redondea cada pedido y se suma; allí se suma y se redondea.",
    "Mes: las pantallas cortan los meses a medianoche de España sobre la hora guardada, y los pedidos de WooCommerce se guardan con la hora de la web como si fuera UTC. Un pedido web de las últimas horas del último día del mes (de 22:00 a 24:00 en verano, de 23:00 a 24:00 en invierno) aquí cuenta en su mes y allí en el siguiente. El de aquí es el del ticket o la factura. Su cobro web cae en el mes siguiente también aquí.",
    "«Cobrado» de las pantallas va por la fecha del cobro: es `cobrado_por_fecha_de_cobro`, no `cobrado`.",
    "Si en Ajustes de Gerencia los pedidos web sin pagar no cuentan (empresa.ajustes.web_sin_pagar_cuenta = false), Gerencia los quita de las ventas; aquí siempre cuentan, y se dan aparte (pedidos_web_sin_pagar, total_neto_web_sin_pagar).",
  ],
  comprobaciones_sugeridas: [
    "Que en cada fila base_neta = bruta_neta + envios_netos, y que la suma de los pedidos de cada mes dé su fila.",
    "Precio real del metro (eur_metro_medido) por mes y tienda frente al precio de Ajustes (empresa.ajustes.precio_metro). eur_metro mezcla metros estimados, que valen el precio de Ajustes por construcción.",
    "Pedidos con eur_metro muy por encima o por debajo de la media, sobre todo manuales (metros_de 'suma_de_cantidades') con líneas que no son metros.",
    "Peso de los metros estimados (metros_de_lineas_estimadas ÷ metros): cuanto más alto, menos se sabe de lo impreso de verdad.",
    "Peso de los envíos y de las devoluciones (también las de los cancelados) sobre la venta.",
    "Margen estimado por mes, por tienda y por metro; pedidos con margen negativo.",
    "Pedidos sin documento_vigente (sobre todo si están cobrados); pedidos con cobro pendiente antiguo, apartando los web sin pagar; pedidos con descuadre distinto de 0.",
  ],
};

const esLineaEstimada = (l: LineaExport) => esEstimado(l.metros_origen);

const sumar = <T>(filas: readonly T[], valor: (f: T) => number) =>
  redondear(filas.reduce((s, f) => s + valor(f), 0));

const TIPOS_DOCUMENTO = new Set(["ordinaria", "rectificativa", "simplificada"]);

export type ExportAnalisis = ReturnType<typeof construirExportAnalisis>;

export function construirExportAnalisis(d: {
  generado: Date;
  /** Qué se exportó: «Tienda Uno» o «Todas las tiendas». */
  alcance: string;
  tiendas: readonly { id: string; nombre: string }[];
  pedidos: readonly PedidoExport[];
  lineas: readonly LineaExport[];
  cobros: readonly CobroExport[];
  documentos: readonly DocumentoExport[];
  /** Coste por metro de hoy (Ajustes › Datos de la empresa), por partidas. */
  costesMetro: CostesMetro;
  ajustes: AjustesExport;
  avisos?: readonly string[];
}) {
  const costeHoy = redondear(
    d.costesMetro.consumibles + d.costesMetro.packaging + d.costesMetro.electricidad,
    4,
  );
  const nombreTienda = new Map(d.tiendas.map((t) => [t.id, t.nombre]));
  const tiendaDe = (id: string) => nombreTienda.get(id) ?? id;
  const agrupar = <T extends { pedido_id: string }>(filas: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const f of filas) {
      const lista = m.get(f.pedido_id);
      if (lista) lista.push(f);
      else m.set(f.pedido_id, [f]);
    }
    return m;
  };
  const lineasDe = agrupar(d.lineas);
  const cobrosDe = agrupar(d.cobros);
  const documentosDe = agrupar(d.documentos);

  const fechaDe = (p: PedidoExport) =>
    fechaDocumentoDePedido(p.fecha_pedido, { horaDeLaWeb: p.origen === "woocommerce" });

  const pedidos = [...d.pedidos]
    .map((p) => ({ p, fecha: fechaDe(p) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.p.id.localeCompare(b.p.id))
    .map(({ p, fecha }) => {
      const cancelado = p.estado === ESTADO_CANCELADO;
      const web = p.origen === "woocommerce";
      const parte = parteVendida(p);
      // Lo que sigue vendido: nada en los cancelados.
      const queda = cancelado ? 0 : parte;
      const base = redondear(baseConEnvio(p));
      const envio = redondear(num(p.envio));
      const bruta = redondear(base - envio);
      const iva = redondear(num(p.iva));
      const total = redondear(num(p.total));
      const base_neta = redondear(base * queda);
      const envio_neto = redondear(envio * queda);
      const bruta_neta = redondear(base_neta - envio_neto);
      const total_neto = redondear(total * queda);

      const filas = lineasDe.get(p.id) ?? [];
      const lineas = filas.map((l) => ({
        descripcion: l.descripcion ?? "",
        cantidad: redondear(num(l.cantidad), 3),
        unidad: l.unidad ?? "",
        precio_unitario: redondear(num(l.precio_unitario), 4),
        subtotal: redondear(num(l.subtotal)),
        iva: redondear(num(l.iva)),
        iva_pct: num(l.iva_rate),
        metros_origen: l.metros_origen ?? null,
        precio_metro_usado: l.precio_metro_usado == null ? null : num(l.precio_metro_usado),
        coste_unit: l.coste_unit_snapshot == null ? null : redondear(num(l.coste_unit_snapshot), 4),
      }));

      // La parte de la bruta que es de metros: en proporción a los subtotales
      // de las líneas, que en WooCommerce van antes de cupones.
      const metros = redondear(num(p.metros_total), 3);
      const enMetros = filas.filter((l) => l.unidad === "m");
      const subLineas = filas.reduce((s, l) => s + num(l.subtotal), 0);
      const subMetros = enMetros.reduce((s, l) => s + num(l.subtotal), 0);
      const venta_metros =
        metros <= 0
          ? 0
          : subMetros > 0 && subLineas > 0
            ? redondear((bruta * subMetros) / subLineas)
            : bruta;
      const metrosEstimados = redondear(
        enMetros.filter(esLineaEstimada).reduce((s, l) => s + num(l.cantidad), 0),
        3,
      );

      const congelado = p.coste_metro_snapshot;
      const sinCongelar = congelado == null || congelado === "";
      const coste = cancelado ? 0 : redondear(costeProduccion([p], costeHoy));

      const cobros = cobrosDe.get(p.id) ?? [];
      const rc = resumenCobros(total_neto, cobros);

      const docs = documentosDe.get(p.id) ?? [];
      // En un canje cuenta la factura: el ticket sustituido deja de valer.
      const sustituidos = docs.flatMap((x) => (x.sustituye_a_id ? [x.sustituye_a_id] : []));
      const vigente = documentoVigente(
        docs
          .filter((x) => TIPOS_DOCUMENTO.has(x.tipo ?? ""))
          .map((x) => ({
            ...x,
            tipo: x.tipo as "ordinaria" | "rectificativa" | "simplificada",
            estado: x.estado ?? null,
            rectifica_a_id: x.rectifica_a_id ?? null,
          })),
        sustituidos,
      );

      return {
        id: p.id,
        numero: p.numero ?? "",
        tienda: tiendaDe(p.tienda_id),
        fecha,
        origen: p.origen ?? "",
        estado: p.estado,
        estado_pago: p.estado_pago ?? null,
        estado_produccion: p.estado_produccion ?? null,
        estado_envio: p.estado_envio ?? null,
        cancelado,
        cancelado_en: p.cancelado_en ?? null,
        motivo_cancelacion: p.motivo_cancelacion ?? null,
        web_sin_pagar: web && p.estado === "pendiente",
        cliente: { id: p.cliente_id ?? null, nombre: p.cliente_nombre ?? null },
        metodo_pago: p.metodo_pago ?? null,
        importes: {
          base,
          envio,
          bruta,
          iva,
          total,
          descuadre: redondear(total - base - iva),
          devuelto: redondear(num(p.devuelto)),
          parte_vendida: redondear(parte, 4),
          base_neta,
          envio_neto,
          bruta_neta,
          iva_neto: redondear(iva * queda),
          total_neto,
        },
        metros,
        metros_de: web ? "lineas_medidas" : "suma_de_cantidades",
        metros_estimados: filas.some(esLineaEstimada),
        metros_de_lineas_estimadas: metrosEstimados,
        venta_metros,
        eur_metro: !cancelado && metros > 0 ? redondear(venta_metros / metros) : null,
        coste_metro: sinCongelar ? costeHoy : redondear(num(congelado), 4),
        coste_metro_es_actual: sinCongelar,
        coste_produccion: coste,
        margen_estimado: cancelado ? 0 : redondear(bruta_neta - coste),
        cobros: {
          cobrado: rc.cobrado,
          pendiente: cancelado ? 0 : rc.pendiente,
          estado: cancelado ? "cancelado" : rc.estado,
          propinas: sumar(cobros, (c) => num(c.propina)),
          lista: cobros.map((c) => ({
            fecha: c.fecha ?? null,
            importe: redondear(num(c.importe)),
            propina: redondear(num(c.propina)),
            metodo: c.metodo ?? null,
          })),
        },
        documento_vigente: vigente?.referencia ?? null,
        documentos: docs.map((x) => ({
          tipo: x.tipo ?? null,
          referencia: x.referencia,
          fecha: x.fecha ?? null,
          estado: x.estado ?? null,
          base_imponible: redondear(num(x.base_imponible)),
          iva_total: redondear(num(x.iva_total)),
          total: redondear(num(x.total)),
          fecha_vencimiento: x.fecha_vencimiento ?? null,
          rectifica_a: x.rectifica_a_id ?? null,
          sustituye_a: x.sustituye_a_id ?? null,
          id: x.id,
        })),
        lineas,
      };
    });
  type Fila = (typeof pedidos)[number];

  // Los cobros por la fecha del cobro, que es como los enseñan las pantallas.
  const pedidoDe = new Map(pedidos.map((p) => [p.id, p]));
  const cobrosPorFecha = d.cobros
    .filter((c) => pedidoDe.has(c.pedido_id))
    .map((c) => ({
      mes: (c.fecha ?? "").slice(0, 7),
      tienda: pedidoDe.get(c.pedido_id)!.tienda,
      importe: num(c.importe),
    }));

  /** Una fila del resumen: sumas de lo ya redondeado en cada pedido. */
  const fila = (lista: readonly Fila[], cobrosDelMes: readonly { importe: number }[]) => {
    const validos = lista.filter((p) => !p.cancelado);
    const cancelados = lista.filter((p) => p.cancelado);
    const conMetros = validos.filter((p) => p.metros > 0);
    const medidos = conMetros.filter(
      (p) => p.metros_de === "lineas_medidas" && !p.metros_estimados,
    );
    const manuales = validos.filter((p) => p.metros_de === "suma_de_cantidades");
    const sinPagar = validos.filter((p) => p.web_sin_pagar);
    const sinDocumento = validos.filter((p) => p.documento_vigente === null);
    const metrosDe = (l: readonly Fila[]) =>
      redondear(
        l.reduce((s, p) => s + p.metros, 0),
        3,
      );
    const precio = (l: readonly Fila[], importe: (p: Fila) => number) => {
      const m = metrosDe(l);
      return m > 0 ? redondear(sumar(l, importe) / m) : null;
    };
    const bruta_neta = sumar(validos, (p) => p.importes.bruta_neta);
    const coste = sumar(validos, (p) => p.coste_produccion);
    return {
      pedidos: validos.length,
      metros: metrosDe(validos),
      base_neta: sumar(validos, (p) => p.importes.base_neta),
      envios_netos: sumar(validos, (p) => p.importes.envio_neto),
      bruta_neta,
      iva_neto: sumar(validos, (p) => p.importes.iva_neto),
      total_neto: sumar(validos, (p) => p.importes.total_neto),
      devuelto: sumar(validos, (p) => p.importes.total - p.importes.total_neto),
      venta_metros: sumar(validos, (p) => p.venta_metros),
      eur_metro: precio(conMetros, (p) => p.venta_metros),
      eur_metro_medido: precio(medidos, (p) => p.venta_metros),
      eur_metro_neto: precio(conMetros, (p) => p.importes.bruta_neta),
      metros_de_lineas_estimadas: redondear(
        validos.reduce((s, p) => s + p.metros_de_lineas_estimadas, 0),
        3,
      ),
      pedidos_con_metros_estimados: validos.filter((p) => p.metros_estimados).length,
      pedidos_manuales: manuales.length,
      metros_manuales: metrosDe(manuales),
      coste_produccion: coste,
      margen_estimado: redondear(bruta_neta - coste),
      cobrado: sumar(validos, (p) => p.cobros.cobrado),
      pendiente: sumar(validos, (p) => p.cobros.pendiente),
      propinas: sumar(validos, (p) => p.cobros.propinas),
      cobrado_por_fecha_de_cobro: sumar(cobrosDelMes, (c) => c.importe),
      pedidos_web_sin_pagar: sinPagar.length,
      total_neto_web_sin_pagar: sumar(sinPagar, (p) => p.importes.total_neto),
      pedidos_sin_documento: sinDocumento.length,
      total_neto_sin_documento: sumar(sinDocumento, (p) => p.importes.total_neto),
      cancelados: cancelados.length,
      importe_cancelados: sumar(cancelados, (p) => p.importes.total),
      devuelto_cancelados: sumar(cancelados, (p) => p.importes.devuelto),
      cobrado_cancelados: sumar(cancelados, (p) => p.cobros.cobrado),
    };
  };

  // Resumen por mes y tienda. Un mes sin pedidos pero con cobros también sale.
  const clave = (mes: string, tienda: string) => `${mes}|${tienda}`;
  const grupos = new Map<string, Fila[]>();
  for (const p of pedidos) {
    const k = clave(p.fecha.slice(0, 7), p.tienda);
    const lista = grupos.get(k);
    if (lista) lista.push(p);
    else grupos.set(k, [p]);
  }
  for (const c of cobrosPorFecha) {
    const k = clave(c.mes, c.tienda);
    if (!grupos.has(k)) grupos.set(k, []);
  }
  const resumen_mensual = [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, lista]) => {
      const [mes, tienda] = k.split("|");
      return {
        mes,
        tienda,
        ...fila(
          lista,
          cobrosPorFecha.filter((c) => c.mes === mes && c.tienda === tienda),
        ),
      };
    });

  const descuadres = pedidos.filter((p) => Math.abs(p.importes.descuadre) >= 0.01).length;
  const avisos = [...(d.avisos ?? [])];
  if (descuadres > 0) {
    avisos.push(
      `${descuadres} pedido(s) en los que base + IVA no da el total: ver importes.descuadre.`,
    );
  }

  return {
    formato: FORMATO_EXPORT_ANALISIS,
    generado: d.generado.toISOString(),
    alcance: d.alcance,
    leeme: LEEME_ANALISIS,
    avisos,
    empresa: {
      coste_metro_hoy: { ...d.costesMetro, total: costeHoy },
      ajustes: d.ajustes,
    },
    tiendas: d.tiendas.map((t) => t.nombre),
    totales: fila(pedidos, cobrosPorFecha),
    resumen_mensual,
    pedidos,
  };
}

/**
 * El fichero en texto: la cabecera legible, con sangría, y cada pedido en una
 * línea (si no, miles de pedidos con sangría ocupan varias veces más).
 */
export function serializarExportAnalisis(e: ExportAnalisis): string {
  const { pedidos, ...cabecera } = e;
  const cab = JSON.stringify(cabecera, null, 2);
  const cuerpo = pedidos.map((p) => "    " + JSON.stringify(p)).join(",\n");
  return `${cab.slice(0, -2)},\n  "pedidos": [\n${cuerpo}\n  ]\n}\n`;
}
