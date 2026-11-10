import { describe, expect, it } from "vitest";
import {
  esSoloUv,
  lineaDeLineaPedido,
  lineaDeProductoWoo,
  lineasDelPedido,
  mencionaUv,
} from "./linea-producto";

describe("mencionaUv", () => {
  it("reconoce UV como palabra, en cualquier forma", () => {
    expect(mencionaUv("DTF UV por Metros Manual")).toBe(true);
    expect(mencionaUv("dtf-uv-por-metros")).toBe(true);
    expect(mencionaUv("DTF UV")).toBe(true);
    expect(mencionaUv("uv")).toBe(true);
  });

  it("no confunde UV dentro de otra palabra", () => {
    expect(mencionaUv("DTF por Metros")).toBe(false);
    expect(mencionaUv("Camiseta uvas")).toBe(false);
    expect(mencionaUv("Suvenir")).toBe(false);
    expect(mencionaUv(null)).toBe(false);
  });
});

describe("lineaDeProductoWoo", () => {
  it("la categoría DTF UV manda", () => {
    expect(
      lineaDeProductoWoo({
        name: "Metros sueltos",
        categories: [{ name: "DTF UV", slug: "dtf-uv" }],
      }),
    ).toBe("uv");
  });

  it("sin categoría de UV, decide el nombre", () => {
    expect(lineaDeProductoWoo({ name: "DTF UV por metros", categories: [] })).toBe("uv");
    expect(
      lineaDeProductoWoo({ name: "DTF por Metros", categories: [{ name: "DTF", slug: "dtf" }] }),
    ).toBe("dtf");
  });
});

describe("lineaDeLineaPedido", () => {
  it("la del catálogo manda sobre el nombre", () => {
    expect(lineaDeLineaPedido("DTF por Metros", "uv")).toBe("uv");
    expect(lineaDeLineaPedido("DTF UV por Metros Manual", "dtf")).toBe("dtf");
  });

  it("sin catálogo, el nombre; y si no dice nada, DTF", () => {
    expect(lineaDeLineaPedido("DTF UV por Metros Manual", null)).toBe("uv");
    expect(lineaDeLineaPedido("DTF por Metros", undefined)).toBe("dtf");
  });
});

describe("lineasDelPedido", () => {
  it("por los metros de cada línea", () => {
    expect(lineasDelPedido({ metros_total: 4.4, metros_uv: 0 })).toBe("dtf");
    expect(lineasDelPedido({ metros_total: 0, metros_uv: "7" })).toBe("uv");
    expect(lineasDelPedido({ metros_total: 2, metros_uv: 1 })).toBe("mixto");
    expect(lineasDelPedido({ metros_total: 0, metros_uv: null })).toBe("ninguna");
  });

  it("solo UV es el que envía la subcontrata", () => {
    expect(esSoloUv({ metros_total: 0, metros_uv: 7 })).toBe(true);
    expect(esSoloUv({ metros_total: 1, metros_uv: 7 })).toBe(false);
  });
});
