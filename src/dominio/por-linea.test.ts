import { describe, expect, it } from "vitest";
import { calcularKpis } from "./kpis";
import { redondear } from "./importes";
import { calcularKpis as kpis, costeProduccion } from "./kpis";
import {
  cifrasPorLinea,
  cobrosDeLinea,
  pendientesDeLinea,
  ventasDeLinea,
  lineasDeUnPedido,
  esFiltroLinea,
  partirPedido,
  pedidosDeLinea,
  type PedidoPartible,
} from "./por-linea";

const pedido = (p: Partial<PedidoPartible> = {}): PedidoPartible => ({
  fecha_pedido: "2026-11-11T10:00:00Z",
  tienda_id: "t",
  estado: "pendiente",
  subtotal: 100,
  iva: 21,
  envio: 0,
  total: 121,
  metros_total: 10,
  coste_metro_snapshot: 2,
  ...p,
});

// DCUL-146-2026: 7 m de UV a 16 €/m y 6 € de portes dentro de la base.
const soloUv = pedido({
  subtotal: 118,
  iva: 24.78,
  envio: 6,
  total: 142.78,
  metros_total: 0,
  metros_uv: 7,
  coste_uv_snapshot: 15,
  bruta_uv: 112,
  iva_uv: 23.52,
});

// Mixto: 4 m de DTF a 7 €/m (28 €) + 2 m de UV a 17,50 €/m (35 €) + 5 € de
// portes: base 68, IVA 14,28, total 82,28.
const mixto = pedido({
  subtotal: 68,
  iva: 14.28,
  envio: 5,
  total: 82.28,
  metros_total: 4,
  metros_uv: 2,
  coste_uv_snapshot: 15,
  bruta_uv: 35,
  iva_uv: 7.35,
});

const soloDtf = pedido();

describe("partirPedido", () => {
  it("un pedido de DTF va entero al DTF", () => {
    const { dtf, uv } = partirPedido(soloDtf);
    expect(dtf).toMatchObject({ subtotal: 100, total: 121, metros_total: 10 });
    expect(uv).toMatchObject({ subtotal: 0, total: 0, metros_uv: 0 });
  });

  it("uno solo de UV va entero al UV, envío incluido", () => {
    const { dtf, uv } = partirPedido(soloUv);
    expect(uv).toMatchObject({ subtotal: 118, envio: 6, total: 142.78, metros_uv: 7 });
    expect(dtf).toMatchObject({ subtotal: 0, envio: 0, total: 0, metros_total: 0 });
  });

  it("un mixto: al UV sus líneas; al DTF el resto, con el envío", () => {
    const { dtf, uv } = partirPedido(mixto);
    expect(uv).toMatchObject({
      subtotal: 35,
      iva: 7.35,
      envio: 0,
      total: 42.35,
      metros_total: 0,
      metros_uv: 2,
    });
    expect(dtf).toMatchObject({
      subtotal: 33,
      iva: 6.93,
      envio: 5,
      total: 39.93,
      metros_total: 4,
      metros_uv: 0,
    });
  });

  it("un mixto sin importes de UV guardados: los euros al DTF, los metros a cada uno", () => {
    const { dtf, uv } = partirPedido({ ...mixto, bruta_uv: null, iva_uv: null });
    expect(dtf).toMatchObject({ subtotal: 68, total: 82.28, metros_total: 4, metros_uv: 0 });
    expect(uv).toMatchObject({ subtotal: 0, total: 0, metros_uv: 2 });
  });

  it("las devoluciones se reparten en proporción", () => {
    const { dtf, uv } = partirPedido({ ...mixto, devuelto: 41.14 });
    expect(Number(dtf.devuelto) + Number(uv.devuelto)).toBeCloseTo(41.14, 2);
    expect(uv.devuelto).toBeCloseTo(41.14 * (42.35 / 82.28), 2);
  });
});

describe("cifrasPorLinea", () => {
  const pedidos = [
    soloDtf,
    soloUv,
    mixto,
    { ...mixto, devuelto: 20 },
    pedido({ estado: "cancelado", metros_total: 3 }),
    { ...soloUv, estado: "cancelado" },
  ];
  const c = cifrasPorLinea(pedidos, 2);

  it("DTF + UV = el total de siempre, al céntimo", () => {
    const antes = calcularKpis(pedidos);
    for (const k of ["bruta", "base", "iva", "envios", "total", "devuelto"] as const) {
      expect(c.todo[k]).toBeCloseTo(antes[k], 2);
      expect(redondear(c.dtf[k] + c.uv[k])).toBe(c.todo[k]);
    }
    expect(c.dtf.coste + c.uv.coste).toBeCloseTo(c.todo.coste, 2);
    expect(c.dtf.ganancia + c.uv.ganancia).toBeCloseTo(c.todo.ganancia, 2);
    expect(c.todo.pedidos).toBe(antes.pedidos);
  });

  it("los metros no se mezclan", () => {
    expect(c.dtf.metros).toBe(10 + 4 + 4);
    expect(c.dtf.metrosUv).toBe(0);
    expect(c.uv.metros).toBe(0);
    expect(c.uv.metrosUv).toBe(7 + 2 + 2);
    expect(c.todo.metros).toBe(18);
    expect(c.todo.metrosUv).toBe(11);
  });

  it("un mixto cuenta como pedido en las dos líneas; los cancelados, en la suya", () => {
    expect(c.dtf.pedidos).toBe(3);
    expect(c.uv.pedidos).toBe(3);
    expect(c.dtf.cancelados).toBe(1);
    expect(c.uv.cancelados).toBe(1);
  });

  it("coste y ganancia del UV: lo que cobra la subcontrata", () => {
    expect(c.uv.coste).toBe(11 * 15);
    expect(c.uv.ganancia).toBeCloseTo(c.uv.bruta - 165, 2);
    // DCUL-146: 112 € de bruta, 105 € de coste, 7 € de ganancia.
    const solo = cifrasPorLinea([soloUv]).uv;
    expect(solo).toMatchObject({ bruta: 112, coste: 105, ganancia: 7, euroMetro: 16 });
  });

  it("sin pedidos, todo a cero", () => {
    const vacio = cifrasPorLinea([]);
    expect(vacio.uv).toMatchObject({ pedidos: 0, bruta: 0, metrosUv: 0, ganancia: 0 });
  });
});

describe("pedidosDeLinea", () => {
  it("las partes de una línea, sin las vacías; con «todo», los pedidos tal cual", () => {
    expect(pedidosDeLinea([soloDtf, soloUv, mixto], "uv")).toHaveLength(2);
    expect(pedidosDeLinea([soloDtf, soloUv, mixto], "dtf")).toHaveLength(2);
    expect(pedidosDeLinea([soloDtf, soloUv, mixto], "todo")).toHaveLength(3);
  });
});

describe("esFiltroLinea", () => {
  it("solo los tres valores", () => {
    expect(["todo", "dtf", "uv"].every(esFiltroLinea)).toBe(true);
    expect(esFiltroLinea("textil")).toBe(false);
  });
});

describe("ventasDeLinea (Gerencia)", () => {
  const textil = { ...pedido({ metros_total: 0 }), canal: "textil" };
  const ventas = [
    { ...soloDtf, canal: "web" },
    { ...soloUv, canal: "web" },
    { ...mixto, canal: "web" },
    textil,
  ];

  it("«Todo», tal cual, con el textil", () => {
    expect(ventasDeLinea(ventas, "todo")).toHaveLength(4);
  });

  it("«DTF»: la parte de DTF de los pedidos de tienda, sin el textil", () => {
    const dtf = ventasDeLinea(ventas, "dtf");
    expect(dtf).toHaveLength(2);
    expect(dtf.every((v) => v.canal !== "textil")).toBe(true);
    expect(kpis(dtf).metros).toBe(14);
  });

  it("«DTF UV»: sus metros y su coste salen con las funciones de siempre", () => {
    const uv = ventasDeLinea(ventas, "uv");
    expect(uv).toHaveLength(2);
    // 7 m + 2 m de UV, como si fueran los metros del pedido.
    expect(kpis(uv).metros).toBe(9);
    expect(kpis(uv).bruta).toBe(112 + 35);
    // A 15 €/m de la subcontrata, aunque el coste de hoy del DTF sea otro.
    expect(costeProduccion(uv, 2)).toBe(9 * 15);
  });

  it("un UV sin coste congelado toma el de la subcontrata por defecto, no el del DTF", () => {
    const uv = ventasDeLinea([{ ...soloUv, coste_uv_snapshot: null, canal: "web" }], "uv");
    expect(costeProduccion(uv, 2)).toBe(7 * 15);
  });
});

describe("cobrosDeLinea y pendientesDeLinea", () => {
  const soloUvIds = new Set(["p-uv"]);
  const cobros = [
    { pedido_id: "p-dtf", tienda_id: "t" },
    { pedido_id: "p-uv", tienda_id: "t" },
    { pedido_id: "p-tx", tienda_id: "textil" },
  ];

  it("los de pedidos solo de UV al UV; el resto de tienda al DTF; el textil, solo en todo", () => {
    expect(cobrosDeLinea(cobros, "todo", soloUvIds, "textil")).toHaveLength(3);
    expect(cobrosDeLinea(cobros, "uv", soloUvIds, "textil").map((c) => c.pedido_id)).toEqual([
      "p-uv",
    ]);
    expect(cobrosDeLinea(cobros, "dtf", soloUvIds, "textil").map((c) => c.pedido_id)).toEqual([
      "p-dtf",
    ]);
  });

  it("los pendientes, con la misma regla", () => {
    const pendientes = [
      { id: "p-dtf", tipo: "tienda" },
      { id: "p-uv", tipo: "tienda" },
      { id: "x", tipo: "textil" },
    ];
    expect(pendientesDeLinea(pendientes, "uv", soloUvIds).map((p) => p.id)).toEqual(["p-uv"]);
    expect(pendientesDeLinea(pendientes, "dtf", soloUvIds).map((p) => p.id)).toEqual(["p-dtf"]);
    expect(pendientesDeLinea(pendientes, "todo", soloUvIds)).toHaveLength(3);
  });
});

describe("lineasDeUnPedido (pedidos manuales y presupuestos)", () => {
  it("los metros de DTF y los de UV por separado, con la base y el IVA del UV", () => {
    const r = lineasDeUnPedido([
      { cantidad: 4, precio_unitario: 7, iva_rate: 21 },
      { cantidad: 2, precio_unitario: 17.5, iva_rate: 21, linea: "uv" },
      { cantidad: 1, precio_unitario: 16, iva_rate: 21, linea: "uv", descuento_pct: 10 },
    ]);
    expect(r).toEqual({ metros_total: 4, metros_uv: 3, bruta_uv: 35 + 14.4, iva_uv: 7.35 + 3.02 });
  });

  it("sin UV, como siempre", () => {
    expect(lineasDeUnPedido([{ cantidad: 5, precio_unitario: 7, iva_rate: 21 }])).toEqual({
      metros_total: 5,
      metros_uv: 0,
      bruta_uv: 0,
      iva_uv: 0,
    });
  });
});

describe("lineasDeUnPedido: el IVA del UV no pasa del del pedido", () => {
  it("con redondeos por línea, se limita al IVA del pedido entero", () => {
    const items = [0.03, 0.03, 0.03].map((b) => ({
      cantidad: 1,
      precio_unitario: b,
      iva_rate: 21,
      linea: "uv" as const,
    }));
    // Cada línea: 0,03 × 21 % = 0,0063 → 0,01; las tres, 0,03. El pedido: 0,09 × 21 % = 0,02.
    expect(lineasDeUnPedido(items).iva_uv).toBe(0.03);
    expect(lineasDeUnPedido(items, 0.02).iva_uv).toBe(0.02);
  });
});
