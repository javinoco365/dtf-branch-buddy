import { describe, expect, it } from "vitest";
import { calcularKpis } from "./kpis";
import { redondear } from "./importes";
import {
  cifrasPorLinea,
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
