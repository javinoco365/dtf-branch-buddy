import { describe, expect, it } from "vitest";
import { lineaPedidoWoo, metrosLineaWoo, metrosPedidoWoo, numeroDeTexto } from "./metros-woo";

// La línea del pedido real de la captura (DTF por Metros, 4,4 m a 7 €/m).
const montador = (extra: Record<string, unknown> = {}) => ({
  name: "DTF por Metros",
  quantity: 1,
  subtotal: "30.83",
  meta_data: [
    { key: "Tamaño de hoja", value: "58 × Auto" },
    { key: "Ancho de hoja (cm)", value: "58" },
    { key: "Longitud de hoja (m)", value: "4.4" },
    { key: "Longitud facturada por trabajo (m)", value: "4.4" },
    { key: "Precio por metro", value: "7,00 €" },
    { key: "Total de hojas", value: "1" },
    { key: "ID del proyecto", value: "8LTBE" },
    { key: "Unidad de medida", value: "cm" },
    { key: "Archivos de impresión", value: [{ url: "x" }] },
  ],
  ...extra,
});

describe("metros de una línea de WooCommerce", () => {
  it("el pedido real: 4,4 m, no 1", () => {
    expect(metrosLineaWoo(montador())).toBe(4.4);
    expect(lineaPedidoWoo(montador())).toEqual({
      cantidad: 4.4,
      unidad: "m",
      precio_unitario: 7.0068,
    });
  });

  it("la cantidad multiplica los metros del trabajo", () => {
    expect(metrosLineaWoo(montador({ quantity: 3 }))).toBe(13.2);
  });

  it("la longitud facturada manda sobre la de la hoja", () => {
    const li = montador();
    li.meta_data = li.meta_data.map((m) =>
      m.key === "Longitud facturada por trabajo (m)" ? { ...m, value: "5" } : m,
    );
    expect(metrosLineaWoo(li)).toBe(5);
  });

  it("sin longitud facturada: longitud de hoja × total de hojas", () => {
    const li = montador();
    li.meta_data = li.meta_data
      .filter((m) => m.key !== "Longitud facturada por trabajo (m)")
      .map((m) => (m.key === "Total de hojas" ? { ...m, value: "3" } : m));
    expect(metrosLineaWoo(li)).toBe(13.2);
  });

  it("lee la etiqueta visible si la clave es interna, y pasa los cm a metros", () => {
    expect(
      metrosLineaWoo({
        name: "Hoja DTF",
        quantity: 2,
        meta_data: [{ key: "_dtfb_len", display_key: "Longitud de hoja (cm)", value: "150" }],
      }),
    ).toBe(3);
  });

  it("sin montador: un producto «por metros» usa la cantidad; otro no es de metros", () => {
    expect(metrosLineaWoo({ name: "DTF por metros", quantity: 2 })).toBe(2);
    expect(metrosLineaWoo({ name: "Camiseta blanca", quantity: 5 })).toBeNull();
    expect(lineaPedidoWoo({ name: "Camiseta blanca", quantity: 5, subtotal: 40 })).toEqual({
      cantidad: 5,
      unidad: "ud",
      precio_unitario: 8,
    });
  });

  it("el pedido suma solo las líneas de metros", () => {
    expect(
      metrosPedidoWoo([montador(), { name: "Camiseta", quantity: 4 }, montador({ quantity: 2 })]),
    ).toBe(13.2);
    expect(metrosPedidoWoo(null)).toBe(0);
  });
});

describe("numeroDeTexto", () => {
  it("entiende coma y punto", () => {
    expect(numeroDeTexto("4.4")).toBe(4.4);
    expect(numeroDeTexto("4,40 m")).toBe(4.4);
    expect(numeroDeTexto("1.234,5")).toBe(1234.5);
    expect(numeroDeTexto("1,234.5")).toBe(1234.5);
    expect(numeroDeTexto(7)).toBe(7);
    expect(numeroDeTexto("Auto")).toBeNull();
    expect(numeroDeTexto([1])).toBeNull();
  });
});
