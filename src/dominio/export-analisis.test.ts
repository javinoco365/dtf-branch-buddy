import { describe, expect, it } from "vitest";
import {
  FORMATO_EXPORT_ANALISIS,
  construirExportAnalisis,
  serializarExportAnalisis,
  type PedidoExport,
} from "./export-analisis";
import { calcularKpis } from "./kpis";

const T1 = "t1";
const pedido = (p: Partial<PedidoExport> & { id: string }): PedidoExport => ({
  fecha_pedido: "2026-10-05T10:00:00+00:00",
  tienda_id: T1,
  estado: "entregado",
  origen: "woocommerce",
  subtotal: 110,
  iva: 23.1,
  envio: 10,
  total: 133.1,
  metros_total: 10,
  coste_metro_snapshot: 2,
  ...p,
});

const base = {
  generado: new Date("2026-10-08T12:00:00Z"),
  alcance: "Tienda Uno",
  tiendas: [{ id: T1, nombre: "Tienda Uno" }],
  costesMetro: { consumibles: 1, packaging: 0.5, electricidad: 0.5 },
  precioMetroAjustes: 7,
};

describe("exportación para análisis", () => {
  const pedidos = [
    // WooCommerce, envío dentro de la base.
    pedido({ id: "a", numero: "A-1" }),
    // Manual antiguo: envío fuera de la base (total = subtotal + iva + envío), sin coste congelado.
    pedido({
      id: "b",
      numero: "B-1",
      origen: "manual",
      fecha_pedido: "2026-09-30T23:30:00+00:00",
      subtotal: 100,
      iva: 21,
      envio: 10,
      total: 131,
      metros_total: 5,
      coste_metro_snapshot: null,
    }),
    // Cancelado: no cuenta.
    pedido({ id: "c", numero: "C-1", estado: "cancelado" }),
    // Con una devolución del 50 %.
    pedido({ id: "d", numero: "D-1", devuelto: 66.55 }),
  ];
  const e = construirExportAnalisis({
    ...base,
    pedidos,
    lineas: [
      {
        pedido_id: "a",
        descripcion: "DTF por Metros",
        cantidad: 10,
        unidad: "m",
        precio_unitario: 10,
        subtotal: 100,
        iva_rate: 21,
        metros_origen: "precio_ajustes",
        precio_metro_usado: 10,
      },
    ],
    cobros: [{ pedido_id: "a", fecha: "2026-10-05", importe: 133.1, propina: 2, metodo: "web" }],
    documentos: [
      { id: "f1", pedido_id: "a", tipo: "simplificada", referencia: "T2026/0001", total: 133.1 },
    ],
  });

  it("se explica solo", () => {
    expect(e.formato).toBe(FORMATO_EXPORT_ANALISIS);
    expect(e.leeme.definiciones.bruta).toMatch(/sin IVA y sin envío/);
    expect(e.empresa.coste_metro_hoy.total).toBe(2);
    expect(e.empresa.precio_metro_ajustes).toBe(7);
  });

  it("cada pedido con su bruta sin envío, sea el modelo que sea", () => {
    const porId = new Map(e.pedidos.map((p) => [p.id, p]));
    expect(porId.get("a")!.importes).toMatchObject({ base: 110, envio: 10, bruta: 100 });
    // El antiguo: la base se completa con el envío; la bruta no se lo quita dos veces.
    expect(porId.get("b")!.importes).toMatchObject({ base: 110, envio: 10, bruta: 100 });
    expect(porId.get("b")!.coste_metro_es_actual).toBe(true);
    expect(porId.get("b")!.coste_produccion).toBe(10);
    expect(porId.get("c")!.margen_estimado).toBe(0);
    expect(porId.get("d")!.importes.parte_vendida).toBe(0.5);
    expect(porId.get("d")!.importes.bruta_neta).toBe(50);
  });

  it("el día del pedido: hora de la web en WooCommerce, hora de España en los manuales", () => {
    const b = e.pedidos.find((p) => p.id === "b")!;
    // 23:30 UTC del 30-9 son las 01:30 del 1-10 en Madrid.
    expect(b.fecha).toBe("2026-10-01");
    expect(e.pedidos[0].fecha <= e.pedidos[e.pedidos.length - 1].fecha).toBe(true);
  });

  it("líneas, metros estimados, cobros y documentos", () => {
    const a = e.pedidos.find((p) => p.id === "a")!;
    expect(a.metros_estimados).toBe(true);
    expect(a.eur_metro).toBe(10);
    expect(a.cobros).toMatchObject({
      cobrado: 133.1,
      pendiente: 0,
      estado: "cobrado",
      propinas: 2,
    });
    expect(a.documentos[0]).toMatchObject({ tipo: "simplificada", referencia: "T2026/0001" });
    expect(a.margen_estimado).toBe(80);
  });

  it("los totales cuadran con calcularKpis, que es lo que enseñan las pantallas", () => {
    const k = calcularKpis(pedidos);
    expect(e.totales).toMatchObject({
      pedidos: k.pedidos,
      cancelados: 1,
      base: k.base,
      envios: k.envios,
      bruta: k.bruta,
      iva: k.iva,
      vendido: k.total,
      metros: k.metros,
    });
    expect(e.totales.base).toBeCloseTo(e.totales.bruta + e.totales.envios, 2);
    expect(e.totales.pedidos_con_metros_estimados).toBe(1);
    // Un mes por cada pedido válido de distinto mes: octubre (a, d, y b por la hora de España).
    expect(e.resumen_mensual.map((r) => r.mes)).toEqual(["2026-10"]);
  });

  it("el texto es JSON válido y trae lo mismo", () => {
    const texto = serializarExportAnalisis(e);
    expect(JSON.parse(texto)).toEqual(JSON.parse(JSON.stringify(e)));
    // Un pedido por línea.
    expect(texto.split("\n").filter((l) => l.trim().startsWith('{"id":')).length).toBe(4);
    const vacio = construirExportAnalisis({
      ...base,
      pedidos: [],
      lineas: [],
      cobros: [],
      documentos: [],
    });
    expect(JSON.parse(serializarExportAnalisis(vacio)).pedidos).toEqual([]);
  });
});
