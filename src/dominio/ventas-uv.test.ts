import { describe, expect, it } from "vitest";
import type { PedidoResumen } from "./kpis";
import { cifrasUv, separarPorLinea } from "./ventas-uv";

const pedido = (p: Partial<PedidoResumen> = {}): PedidoResumen => ({
  fecha_pedido: "2026-11-10T10:00:00Z",
  tienda_id: "t",
  estado: "pendiente",
  subtotal: 100,
  iva: 21,
  envio: 0,
  total: 121,
  metros_total: 10,
  ...p,
});

// DCUL-146-2026: 7 m de UV a 16 €/m, 6 € de portes dentro de la base.
const dcul146 = pedido({
  subtotal: 118,
  iva: 24.78,
  envio: 6,
  total: 142.78,
  metros_total: 0,
  metros_uv: 7,
  coste_uv_snapshot: 15,
});

describe("separarPorLinea", () => {
  it("los de solo UV van aparte; los mixtos y los sin metros, con el DTF", () => {
    const dtf = pedido();
    const mixto = pedido({ metros_total: 2, metros_uv: 1 });
    const sinMetros = pedido({ metros_total: 0 });
    const r = separarPorLinea([dtf, dcul146, mixto, sinMetros]);
    expect(r.uv).toEqual([dcul146]);
    expect(r.dtf).toEqual([dtf, mixto, sinMetros]);
    expect(r.mixtos).toBe(1);
  });

  it("un mixto cancelado no se avisa", () => {
    expect(
      separarPorLinea([pedido({ metros_total: 2, metros_uv: 1, estado: "cancelado" })]).mixtos,
    ).toBe(0);
  });
});

describe("cifrasUv", () => {
  it("vendido, bruta sin envío, coste de la subcontrata y ganancia", () => {
    expect(cifrasUv([dcul146])).toEqual({
      pedidos: 1,
      metros: 7,
      vendido: 142.78,
      bruta: 112,
      coste: 105,
      ganancia: 7,
      gananciaMetro: 1,
    });
  });

  it("los cancelados no cuentan; sin pedidos, todo a cero", () => {
    expect(cifrasUv([{ ...dcul146, estado: "cancelado" }])).toEqual({
      pedidos: 0,
      metros: 0,
      vendido: 0,
      bruta: 0,
      coste: 0,
      ganancia: 0,
      gananciaMetro: 0,
    });
  });
});
