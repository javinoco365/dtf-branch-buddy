import { describe, expect, it } from "vitest";
import { importesPedidoWoo, numeroPedidoWoo } from "./pedido-woo";

describe("numeroPedidoWoo", () => {
  it("coge el número del plugin tal cual lo ve el cliente", () => {
    // El caso real de DTF Culture: el plugin de numeración sustituye
    // get_order_number(), así que la API ya devuelve el número completo.
    expect(numeroPedidoWoo({ id: 432, number: "DCUL-23-2026" })).toBe("DCUL-23-2026");
  });

  it("prefiere el número completo de la API a la parte suelta del meta", () => {
    // Este es el orden que importa: muchos plugins dejan en _order_number solo
    // el «23». Preferirlo daría un número incompleto, peor que el problema que
    // se venía a resolver.
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "DCUL-23-2026",
        meta_data: [{ key: "_order_number", value: "23" }],
      }),
    ).toBe("DCUL-23-2026");
  });

  it("usa el meta cuando el plugin guarda pero no filtra la API", () => {
    // Aquí number sigue valiendo lo mismo que el id: el plugin no sustituyó
    // get_order_number(), solo dejó el número guardado.
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_order_number", value: "23" },
          { key: "_order_number_formatted", value: "DCUL-23-2026" },
        ],
      }),
    ).toBe("DCUL-23-2026");
  });

  it("cae en el meta sin formatear si no hay formateado", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [{ key: "_order_number", value: 1043 }],
      }),
    ).toBe("1043");
  });

  it("sin plugin, number e id valen lo mismo y devuelve ese número", () => {
    expect(numeroPedidoWoo({ id: 432, number: 432, meta_data: [] })).toBe("432");
    expect(numeroPedidoWoo({ id: 432, number: "432" })).toBe("432");
  });

  it("solo usa el id cuando no hay absolutamente nada más", () => {
    expect(numeroPedidoWoo({ id: 432 })).toBe("432");
    expect(numeroPedidoWoo({ id: 432, number: "  " })).toBe("432");
  });

  it("ignora las claves de meta que no son de numeración", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_billing_nif", value: "B12345678" },
          { key: "is_vat_exempt", value: "no" },
        ],
      }),
    ).toBe("432");
  });

  it("ignora un meta presente pero vacío", () => {
    // Los plugins dejan la clave creada aunque no le hayan puesto valor.
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_order_number_formatted", value: "" },
          { key: "_order_number", value: null },
        ],
      }),
    ).toBe("432");
  });

  it("ignora valores que no son ni texto ni número", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [{ key: "_order_number_formatted", value: { raro: true } }],
      }),
    ).toBe("432");
  });

  it("no se rompe sin pedido ni sin meta_data", () => {
    expect(numeroPedidoWoo(null)).toBe("");
    expect(numeroPedidoWoo(undefined)).toBe("");
    expect(numeroPedidoWoo({})).toBe("");
    expect(numeroPedidoWoo({ id: 1, meta_data: null })).toBe("1");
  });
});

describe("importes del pedido de WooCommerce", () => {
  it("guarda el envío aparte, sin IVA, y la base con el envío dentro", () => {
    // 20 m a 7 € + 5 € de envío, todo al 21 %: 145 € de base, 30,45 de IVA.
    expect(
      importesPedidoWoo({ total: "175.45", total_tax: "30.45", shipping_total: "5.00" }),
    ).toEqual({ subtotal: 145, iva: 30.45, envio: 5, total: 175.45 });
  });

  it("sin envío o con datos raros, cero y no NaN", () => {
    expect(importesPedidoWoo({ total: "12.10", total_tax: "2.10" }).envio).toBe(0);
    expect(importesPedidoWoo({ total: null, total_tax: "x", shipping_total: "-3" })).toEqual({
      subtotal: 0,
      iva: 0,
      envio: 0,
      total: 0,
    });
  });
});
