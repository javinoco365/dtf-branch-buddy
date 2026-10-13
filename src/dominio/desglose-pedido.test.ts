import { describe, expect, it } from "vitest";
import { desglosePedido } from "./desglose-pedido";
import { importesPedidoWoo } from "./pedido-woo";
import { calcularTotales } from "./importes";

const cuadra = (d: ReturnType<typeof desglosePedido>) =>
  expect(d.productos + d.envio + d.iva).toBeCloseTo(d.total, 2);

describe("desglosePedido", () => {
  it("un pedido de WooCommerce: el subtotal ya lleva el envío y no se cuenta dos veces", () => {
    // 100 € de productos y 10 € de envío, sin IVA; 23,10 € de IVA.
    const woo = importesPedidoWoo({ total: "133.10", total_tax: "23.10", shipping_total: "10.00" });
    expect(woo.subtotal).toBe(110);
    const d = desglosePedido(woo);
    expect(d).toEqual({ productos: 100, envio: 10, iva: 23.1, total: 133.1 });
    cuadra(d);
  });

  it("un pedido manual de ahora: la base de calcularTotales lleva el envío", () => {
    const t = calcularTotales([{ cantidad: 2, precio_unitario: 25, iva_rate: 21 }], { envio: 6 });
    const d = desglosePedido({
      subtotal: t.base_imponible,
      iva: t.iva_total,
      envio: 6,
      total: t.total,
    });
    expect(d.productos).toBe(50);
    expect(d.envio).toBe(6);
    expect(d.total).toBe(t.total);
    cuadra(d);
  });

  it("un pedido manual antiguo, con el envío fuera del subtotal", () => {
    // total = subtotal + IVA + envío.
    const d = desglosePedido({ subtotal: 100, iva: 21, envio: 10, total: 131 });
    expect(d).toEqual({ productos: 100, envio: 10, iva: 21, total: 131 });
    cuadra(d);
  });

  it("sin envío, los productos son el subtotal", () => {
    const d = desglosePedido({ subtotal: "82.64", iva: "17.36", envio: 0, total: "100" });
    expect(d).toEqual({ productos: 82.64, envio: 0, iva: 17.36, total: 100 });
    cuadra(d);
  });

  it("el total es siempre el del pedido, aunque las cifras guardadas no cuadren", () => {
    const d = desglosePedido({ subtotal: 50, iva: 10.5, envio: 5, total: 70 });
    expect(d.total).toBe(70);
    expect(d.envio).toBe(5);
  });

  it("los nulos cuentan como cero", () => {
    expect(desglosePedido({ subtotal: null, iva: null, envio: null, total: null })).toEqual({
      productos: 0,
      envio: 0,
      iva: 0,
      total: 0,
    });
  });
});
