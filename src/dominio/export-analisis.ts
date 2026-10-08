/**
 * La exportación de pedidos para análisis: un fichero que se explica solo,
 * pensado para dárselo a Claude (o a cualquier analista) y que pueda comprobar
 * las cuentas sin abrir el CRM.
 *
 * Lleva, además de los pedidos con sus líneas, qué significa cada campo, cómo
 * se calcula y un resumen por mes y tienda hecho con las mismas funciones que
 * las pantallas (calcularKpis, costeProduccion…): si el resumen y la pantalla
 * no coinciden, el fallo es de los datos, no de dos maneras de contar.
 *
 * Lógica pura: recibe las filas ya leídas.
 */

import {
  ESTADO_CANCELADO,
  baseConEnvio,
  calcularKpis,
  costeProduccion,
  parteVendida,
  type PedidoResumen,
} from "./kpis";
import { resumenCobros } from "./cobros";
import { fechaDocumentoDePedido } from "./fecha-documento";
import { redondear } from "./importes";

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
};

export type LineaExport = {
  pedido_id: string;
  descripcion?: string | null;
  cantidad?: number | string | null;
  unidad?: string | null;
  precio_unitario?: number | string | null;
  iva_rate?: number | string | null;
  subtotal?: number | string | null;
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
  total?: number | string | null;
  rectifica_a_id?: string | null;
  sustituye_a_id?: string | null;
};

export type CostesMetro = { consumibles: number; packaging: number; electricidad: number };

/** Lo que el fichero explica de sí mismo. Se lee antes que los datos. */
export const LEEME_ANALISIS = {
  proposito:
    "Pedidos de DTF por metros de las tiendas de DTI S.L. (RONOCA DESARROLLOS S.L.), exportados del CRM para comprobaciones económicas: precio real del metro, márgenes, envíos, devoluciones, cobros y documentos fiscales.",
  moneda: "EUR. Importes con 2 decimales; metros con 3.",
  fechas:
    "`fecha` es el día del pedido en hora de España (la de la web en los de WooCommerce). `mes` es yyyy-mm de esa fecha.",
  definiciones: {
    base: "Base imponible del pedido, con el envío dentro. base + iva = total.",
    envio: "Envío cobrado al cliente, sin IVA. Va dentro de la base, no de la bruta.",
    bruta:
      "Facturación bruta: lo vendido sin IVA y sin envío (base − envío). Es la cifra de «Facturación bruta» de las pantallas.",
    iva: "IVA repercutido del pedido.",
    total: "Lo que paga el cliente: base + IVA (envío incluido).",
    devuelto: "Reembolsos de WooCommerce, con IVA.",
    parte_vendida:
      "Qué parte del pedido sigue vendida después de devoluciones (1 = nada devuelto). Las cifras netas multiplican por ella: WooCommerce no dice qué líneas se devolvieron.",
    bruta_neta: "bruta × parte_vendida. Es lo que suman los resúmenes.",
    metros: "Metros lineales impresos del pedido (suma de las líneas en metros).",
    metros_estimados:
      "Líneas cuyos metros no vinieron medidos del montador de DTFBuild sino estimados como importe ÷ precio por metro (metros_origen 'precio_ajustes' o 'precio_linea').",
    coste_metro:
      "Coste de producción por metro (consumibles + embalaje + electricidad) congelado al crear el pedido. Si el pedido es anterior a congelarlo, el de hoy (coste_metro_es_actual = true).",
    coste_produccion:
      "metros × coste_metro. No incluye el envío (lo que se cobra se paga a la agencia).",
    margen_estimado:
      "bruta_neta − coste_produccion. Estimación: no incluye gastos fijos, sueldos ni el coste de lo que no va en metros.",
    eur_metro:
      "bruta ÷ metros de los pedidos con metros: precio medio real del metro sin IVA ni envío.",
    cobros:
      "Dinero recibido por el pedido. `pendiente` = total − cobrado (puede ser negativo si se cobró de más). Las propinas van aparte y no cuentan como cobro del pedido.",
    documentos:
      "Tickets (simplificada), facturas (ordinaria) y rectificativas emitidas para el pedido. Una rectificativa anula o corrige a la que señala rectifica_a_id; un canje sustituye un ticket (sustituye_a_id).",
  },
  reglas: [
    "Los pedidos cancelados no cuentan en ventas, metros ni costes: se cuentan aparte.",
    "Los importes y costes de cada pedido son los congelados al crearlo; no se recalculan con los precios de hoy.",
    "Las líneas de metros 'estimados' pueden no coincidir con lo que se imprimió de verdad: conviene revisarlas.",
    "No hay datos de contacto de los clientes (ni email, ni teléfono, ni dirección): solo su id y su nombre.",
  ],
  comprobaciones_sugeridas: [
    "Que en cada mes base = bruta + envíos y base + iva = total (vendido).",
    "Precio real del metro (eur_metro) por mes y tienda frente al precio de Ajustes (empresa.precio_metro_ajustes).",
    "Pedidos con el precio por metro muy por encima o por debajo de la media (posibles errores de metros).",
    "Peso de los envíos y de las devoluciones sobre la venta.",
    "Margen estimado por mes, por tienda y por metro; pedidos con margen negativo.",
    "Pedidos cobrados sin ticket ni factura, y pedidos con cobro pendiente antiguo.",
  ],
};

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
  /** Precio por metro sin IVA de Ajustes de Gerencia, si lo hay. */
  precioMetroAjustes: number | null;
  avisos?: readonly string[];
}) {
  const costeHoy = redondear(
    d.costesMetro.consumibles + d.costesMetro.packaging + d.costesMetro.electricidad,
    4,
  );
  const nombreTienda = new Map(d.tiendas.map((t) => [t.id, t.nombre]));
  const agrupar = <T extends { pedido_id: string }>(filas: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const f of filas) m.set(f.pedido_id, [...(m.get(f.pedido_id) ?? []), f]);
    return m;
  };
  const lineasDe = agrupar(d.lineas);
  const cobrosDe = agrupar(d.cobros);
  const documentosDe = agrupar(d.documentos);

  const fechaDe = (p: PedidoExport) =>
    fechaDocumentoDePedido(p.fecha_pedido, { horaDeLaWeb: p.origen === "woocommerce" });

  const pedidos = [...d.pedidos]
    .sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)) || a.id.localeCompare(b.id))
    .map((p) => {
      const cancelado = p.estado === ESTADO_CANCELADO;
      const parte = parteVendida(p);
      const base = redondear(baseConEnvio(p));
      const envio = redondear(num(p.envio));
      const bruta = redondear(base - envio);
      const metros = redondear(num(p.metros_total), 3);
      const congelado = p.coste_metro_snapshot;
      const costeMetro =
        congelado == null || congelado === "" ? costeHoy : redondear(num(congelado), 4);
      const coste = cancelado ? 0 : redondear(costeProduccion([p], costeHoy));
      const lineas = (lineasDe.get(p.id) ?? []).map((l) => ({
        descripcion: l.descripcion ?? "",
        cantidad: redondear(num(l.cantidad), 3),
        unidad: l.unidad ?? "",
        precio_unitario: redondear(num(l.precio_unitario), 4),
        subtotal: redondear(num(l.subtotal)),
        iva_pct: num(l.iva_rate),
        metros_origen: l.metros_origen ?? null,
        precio_metro_usado: l.precio_metro_usado == null ? null : num(l.precio_metro_usado),
        coste_unit: l.coste_unit_snapshot == null ? null : redondear(num(l.coste_unit_snapshot), 4),
      }));
      const cobros = cobrosDe.get(p.id) ?? [];
      const rc = resumenCobros(p.total, cobros);
      return {
        id: p.id,
        numero: p.numero ?? "",
        tienda: nombreTienda.get(p.tienda_id) ?? p.tienda_id,
        fecha: fechaDe(p),
        origen: p.origen ?? "",
        estado: p.estado,
        estado_pago: p.estado_pago ?? null,
        estado_produccion: p.estado_produccion ?? null,
        estado_envio: p.estado_envio ?? null,
        cancelado,
        cliente: { id: p.cliente_id ?? null, nombre: p.cliente_nombre ?? null },
        metodo_pago: p.metodo_pago ?? null,
        importes: {
          base,
          envio,
          bruta,
          iva: redondear(num(p.iva)),
          total: redondear(num(p.total)),
          devuelto: redondear(num(p.devuelto)),
          parte_vendida: redondear(parte, 4),
          bruta_neta: cancelado ? 0 : redondear(bruta * parte),
        },
        metros,
        metros_estimados: lineas.some(
          (l) => l.metros_origen === "precio_ajustes" || l.metros_origen === "precio_linea",
        ),
        eur_metro: metros > 0 ? redondear(bruta / metros) : null,
        coste_metro: costeMetro,
        coste_metro_es_actual: congelado == null || congelado === "",
        coste_produccion: coste,
        margen_estimado: cancelado ? 0 : redondear(bruta * parte - coste),
        cobros: {
          cobrado: rc.cobrado,
          pendiente: rc.pendiente,
          estado: rc.estado,
          propinas: redondear(cobros.reduce((s, c) => s + num(c.propina), 0)),
          lista: cobros.map((c) => ({
            fecha: c.fecha ?? null,
            importe: redondear(num(c.importe)),
            metodo: c.metodo ?? null,
          })),
        },
        documentos: (documentosDe.get(p.id) ?? []).map((x) => ({
          tipo: x.tipo ?? null,
          referencia: x.referencia,
          fecha: x.fecha ?? null,
          estado: x.estado ?? null,
          total: redondear(num(x.total)),
          rectifica_a: x.rectifica_a_id ?? null,
          sustituye_a: x.sustituye_a_id ?? null,
          id: x.id,
        })),
        lineas,
      };
    });

  // Resumen por mes y tienda, con las funciones de las pantallas.
  const grupos = new Map<string, PedidoExport[]>();
  for (const p of d.pedidos) {
    const clave = `${fechaDe(p).slice(0, 7)}|${nombreTienda.get(p.tienda_id) ?? p.tienda_id}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }
  const fila = (lista: readonly PedidoExport[]) => {
    const k = calcularKpis(lista);
    const coste = costeProduccion(lista, costeHoy);
    const conMetros = calcularKpis(lista.filter((p) => num(p.metros_total) > 0));
    const validos = lista.filter((p) => p.estado !== ESTADO_CANCELADO);
    return {
      pedidos: k.pedidos,
      cancelados: k.cancelados,
      metros: k.metros,
      base: k.base,
      envios: k.envios,
      bruta: k.bruta,
      iva: k.iva,
      vendido: k.total,
      devuelto: k.devuelto,
      cobrado: redondear(
        validos.reduce(
          (s, p) => s + (cobrosDe.get(p.id) ?? []).reduce((t, c) => t + num(c.importe), 0),
          0,
        ),
      ),
      coste_produccion: coste,
      margen_estimado: redondear(k.bruta - coste),
      eur_metro: conMetros.metros > 0 ? redondear(conMetros.bruta / conMetros.metros) : null,
      pedidos_con_metros_estimados: validos.filter((p) =>
        (lineasDe.get(p.id) ?? []).some(
          (l) => l.metros_origen === "precio_ajustes" || l.metros_origen === "precio_linea",
        ),
      ).length,
    };
  };
  const resumen_mensual = [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([clave, lista]) => {
      const [mes, tienda] = clave.split("|");
      return { mes, tienda, ...fila(lista) };
    });

  return {
    formato: FORMATO_EXPORT_ANALISIS,
    generado: d.generado.toISOString(),
    alcance: d.alcance,
    leeme: LEEME_ANALISIS,
    avisos: [...(d.avisos ?? [])],
    empresa: {
      coste_metro_hoy: { ...d.costesMetro, total: costeHoy },
      precio_metro_ajustes: d.precioMetroAjustes,
    },
    tiendas: d.tiendas.map((t) => t.nombre),
    totales: fila(d.pedidos),
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
