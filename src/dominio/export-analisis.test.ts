import { describe, expect, it } from "vitest";
import {
  FORMATO_EXPORT_ANALISIS,
  construirExportAnalisis,
  serializarExportAnalisis,
  type CobroExport,
  type LineaExport,
  type PedidoExport,
} from "./export-analisis";
import { calcularKpis, costeProduccion } from "./kpis";
import { redondear } from "./importes";

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

const exportar = (
  pedidos: PedidoExport[],
  extra: { lineas?: LineaExport[]; cobros?: CobroExport[] } = {},
) =>
  construirExportAnalisis({
    ...base,
    pedidos,
    lineas: extra.lineas ?? [],
    cobros: extra.cobros ?? [],
    documentos: [],
  });

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
  const porId = new Map(e.pedidos.map((p) => [p.id, p]));

  it("se explica solo", () => {
    expect(e.formato).toBe(FORMATO_EXPORT_ANALISIS);
    expect(e.leeme.definiciones.bruta).toMatch(/sin IVA y sin envío/);
    expect(e.leeme.diferencias_con_las_pantallas.length).toBeGreaterThan(0);
    expect(e.empresa.coste_metro_hoy.total).toBe(2);
    expect(e.empresa.precio_metro_ajustes).toBe(7);
  });

  it("cada pedido con su bruta sin envío, sea el modelo que sea", () => {
    expect(porId.get("a")!.importes).toMatchObject({ base: 110, envio: 10, bruta: 100 });
    // El antiguo: la base se completa con el envío; la bruta no se lo quita dos veces.
    expect(porId.get("b")!.importes).toMatchObject({
      base: 110,
      envio: 10,
      bruta: 100,
      descuadre: 0,
    });
    expect(porId.get("b")!.coste_metro_es_actual).toBe(true);
    expect(porId.get("b")!.coste_produccion).toBe(10);
    expect(porId.get("b")!.metros_de).toBe("suma_de_cantidades");
    expect(porId.get("a")!.metros_de).toBe("lineas_medidas");
  });

  it("importes brutos y netos de devoluciones, con su nombre", () => {
    const d = porId.get("d")!;
    expect(d.importes).toMatchObject({
      base: 110,
      bruta: 100,
      total: 133.1,
      parte_vendida: 0.5,
      base_neta: 55,
      envio_neto: 5,
      bruta_neta: 50,
      iva_neto: 11.55,
      total_neto: 66.55,
    });
    // El cancelado no vende nada, pero conserva sus importes.
    expect(porId.get("c")!.importes).toMatchObject({ total: 133.1, bruta_neta: 0, total_neto: 0 });
    expect(porId.get("c")!.margen_estimado).toBe(0);
    expect(porId.get("c")!.eur_metro).toBeNull();
  });

  it("el día del pedido: hora de la web en WooCommerce, hora de España en los manuales", () => {
    const b = porId.get("b")!;
    // 23:30 UTC del 30-9 son las 01:30 del 1-10 en Madrid.
    expect(b.fecha).toBe("2026-10-01");
    expect(e.pedidos[0].fecha <= e.pedidos[e.pedidos.length - 1].fecha).toBe(true);
  });

  it("líneas, metros estimados, cobros y documentos", () => {
    const a = porId.get("a")!;
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

  it("los totales coinciden con calcularKpis, que es lo que enseñan las pantallas", () => {
    const k = calcularKpis(pedidos);
    expect(e.totales).toMatchObject({
      pedidos: k.pedidos,
      cancelados: k.cancelados,
      base_neta: k.base,
      envios_netos: k.envios,
      bruta_neta: k.bruta,
      iva_neto: k.iva,
      total_neto: k.total,
      devuelto: k.devuelto,
      metros: k.metros,
      coste_produccion: costeProduccion(pedidos, 2),
    });
    expect(e.totales.pedidos_con_metros_estimados).toBe(1);
    // Octubre: a, d, y b por la hora de España.
    expect(e.resumen_mensual.map((r) => r.mes)).toEqual(["2026-10"]);
  });

  it("el texto es JSON válido y trae lo mismo", () => {
    const texto = serializarExportAnalisis(e);
    expect(JSON.parse(texto)).toEqual(JSON.parse(JSON.stringify(e)));
    // Un pedido por línea.
    expect(texto.split("\n").filter((l) => l.trim().startsWith('{"id":')).length).toBe(4);
    const vacio = exportar([]);
    expect(JSON.parse(serializarExportAnalisis(vacio)).pedidos).toEqual([]);
    expect(vacio.totales.eur_metro).toBeNull();
  });
});

describe("cobros en la exportación", () => {
  it("el pendiente se mide contra el total neto: un reembolso parcial no deja deuda", () => {
    // Pedido web de 121 € con 60,50 devueltos; el cobro web ya es neto.
    const e = exportar(
      [pedido({ id: "w", subtotal: 100, iva: 21, envio: 0, total: 121, devuelto: 60.5 })],
      { cobros: [{ pedido_id: "w", fecha: "2026-10-05", importe: 60.5 }] },
    );
    expect(e.pedidos[0].cobros).toMatchObject({ cobrado: 60.5, pendiente: 0, estado: "cobrado" });
    expect(e.totales).toMatchObject({ total_neto: 60.5, cobrado: 60.5, pendiente: 0 });
  });

  it("los cancelados: sin pendiente, y sus cobros aparte", () => {
    const e = exportar(
      [
        pedido({ id: "x", estado: "cancelado", total: 121, subtotal: 100, iva: 21, envio: 0 }),
        pedido({ id: "y", estado: "cancelado", total: 50, subtotal: 41.32, iva: 8.68, envio: 0 }),
        pedido({ id: "v", total: 121, subtotal: 100, iva: 21, envio: 0 }),
      ],
      {
        cobros: [
          { pedido_id: "y", fecha: "2026-10-05", importe: 50 },
          { pedido_id: "v", fecha: "2026-10-05", importe: 21 },
        ],
      },
    );
    const x = e.pedidos.find((p) => p.id === "x")!;
    expect(x.cobros).toMatchObject({ cobrado: 0, pendiente: 0, estado: "cancelado" });
    expect(e.totales).toMatchObject({
      cobrado: 21,
      pendiente: 100,
      cobrado_cancelados: 50,
      importe_cancelados: 171,
      cobrado_por_fecha_de_cobro: 71,
    });
    // La suma de lo cobrado de los pedidos = cobrado + cobrado_cancelados.
    const suma = redondear(e.pedidos.reduce((s, p) => s + p.cobros.cobrado, 0));
    expect(suma).toBe(redondear(e.totales.cobrado + e.totales.cobrado_cancelados));
  });

  it("lo cobrado por fecha de cobro cae en el mes del cobro, aunque no haya pedidos ese mes", () => {
    const e = exportar([pedido({ id: "s", fecha_pedido: "2026-09-17T10:00:00+00:00" })], {
      cobros: [{ pedido_id: "s", fecha: "2026-11-02", importe: 133.1 }],
    });
    const sep = e.resumen_mensual.find((r) => r.mes === "2026-09")!;
    const nov = e.resumen_mensual.find((r) => r.mes === "2026-11")!;
    expect(sep).toMatchObject({ pedidos: 1, cobrado: 133.1, cobrado_por_fecha_de_cobro: 0 });
    expect(nov).toMatchObject({ pedidos: 0, cobrado: 0, cobrado_por_fecha_de_cobro: 133.1 });
  });

  it("un reembolso total (cancelado) se ve en devuelto_cancelados", () => {
    const e = exportar([
      pedido({
        id: "r",
        estado: "cancelado",
        subtotal: 100,
        iva: 21,
        envio: 0,
        total: 121,
        devuelto: 121,
      }),
    ]);
    expect(e.totales).toMatchObject({ devuelto: 0, devuelto_cancelados: 121, cancelados: 1 });
  });
});

describe("precio del metro", () => {
  it("solo con lo que va en metros, repartiendo los cupones", () => {
    // 5 m a 12 € y una camiseta de 40 €, con un cupón del 10 % en el pedido.
    const e = exportar(
      [pedido({ id: "m", subtotal: 90, iva: 18.9, envio: 0, total: 108.9, metros_total: 5 })],
      {
        lineas: [
          { pedido_id: "m", descripcion: "Metro DTF", cantidad: 5, unidad: "m", subtotal: 60 },
          { pedido_id: "m", descripcion: "Camiseta", cantidad: 1, unidad: "ud", subtotal: 40 },
        ],
      },
    );
    const m = e.pedidos[0];
    expect(m.venta_metros).toBe(54);
    expect(m.eur_metro).toBe(10.8);
    expect(e.totales.eur_metro).toBe(10.8);
    // El de Gerencia: toda la bruta entre los metros.
    expect(e.totales.eur_metro_neto).toBe(18);
  });

  it("el del mes no cambia con las devoluciones; el neto, sí", () => {
    const e = exportar([
      pedido({
        id: "h",
        subtotal: 100,
        iva: 21,
        envio: 0,
        total: 121,
        devuelto: 60.5,
        metros_total: 10,
      }),
    ]);
    expect(e.pedidos[0].eur_metro).toBe(10);
    expect(e.totales.eur_metro).toBe(10);
    expect(e.totales.eur_metro_neto).toBe(5);
  });
});

describe("el resumen cuadra al céntimo con los pedidos", () => {
  // Pedidos al azar (pero siempre los mismos) con devoluciones parciales.
  let semilla = 7;
  const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return semilla / 2147483647;
  };
  const muchos = Array.from({ length: 300 }, (_, i) => {
    const subtotal = redondear(5 + azar() * 400);
    const envio = azar() < 0.4 ? redondear(azar() * 9) : 0;
    const iva = redondear(subtotal * 0.21);
    const total = redondear(subtotal + iva);
    return pedido({
      id: `p${i}`,
      fecha_pedido: `2026-${String(1 + (i % 9)).padStart(2, "0")}-1${i % 9}T10:00:00+00:00`,
      tienda_id: i % 3 ? T1 : "t2",
      estado: azar() < 0.1 ? "cancelado" : "entregado",
      subtotal,
      iva,
      envio,
      total,
      devuelto: azar() < 0.3 ? redondear(total * azar()) : 0,
      metros_total: redondear(azar() * 30, 3),
    });
  });
  const e = construirExportAnalisis({
    ...base,
    tiendas: [...base.tiendas, { id: "t2", nombre: "Tienda Dos" }],
    pedidos: muchos,
    lineas: [],
    cobros: [],
    documentos: [],
  });

  it("cada fila es la suma de sus pedidos, y base = bruta + envíos exacto", () => {
    for (const r of e.resumen_mensual) {
      const suyos = e.pedidos.filter(
        (p) => p.fecha.slice(0, 7) === r.mes && p.tienda === r.tienda && !p.cancelado,
      );
      const suma = (f: (p: (typeof suyos)[number]) => number) =>
        redondear(suyos.reduce((s, p) => s + f(p), 0));
      expect(r.base_neta).toBe(suma((p) => p.importes.base_neta));
      expect(r.bruta_neta).toBe(suma((p) => p.importes.bruta_neta));
      expect(r.total_neto).toBe(suma((p) => p.importes.total_neto));
      expect(r.base_neta).toBe(redondear(r.bruta_neta + r.envios_netos));
    }
    const filas = (f: (r: (typeof e.resumen_mensual)[number]) => number) =>
      redondear(e.resumen_mensual.reduce((s, r) => s + f(r), 0));
    expect(e.totales.bruta_neta).toBe(filas((r) => r.bruta_neta));
    expect(e.totales.pedidos).toBe(filas((r) => r.pedidos));
  });

  it("y difiere de las pantallas como mucho en medio céntimo por pedido", () => {
    const k = calcularKpis(muchos);
    const tope = k.pedidos * 0.005 + 0.01;
    expect(Math.abs(e.totales.base_neta - k.base)).toBeLessThanOrEqual(tope);
    expect(Math.abs(e.totales.bruta_neta - k.bruta)).toBeLessThanOrEqual(tope);
    expect(Math.abs(e.totales.iva_neto - k.iva)).toBeLessThanOrEqual(tope);
    expect(Math.abs(e.totales.total_neto - k.total)).toBeLessThanOrEqual(tope);
    expect(e.totales.metros).toBe(k.metros);
  });

  it("avisa de los pedidos cuyo total no cuadra", () => {
    const raro = exportar([pedido({ id: "z", subtotal: 100, iva: 21, envio: 0, total: 125 })]);
    expect(raro.pedidos[0].importes.descuadre).toBe(4);
    expect(raro.avisos.join(" ")).toMatch(/1 pedido/);
  });
});
