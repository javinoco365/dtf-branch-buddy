import { describe, expect, it } from "vitest";
import { MIN_MUESTRAS_CATALOGO, mediana, precioRecomendado } from "./precio-recomendado";

type Muestra = Parameters<typeof precioRecomendado>[1][number];
const m = (
  id: string,
  producto_id: string | null,
  coste: number,
  precio: number,
  extra: Partial<Muestra> = {},
): Muestra => ({
  id,
  producto_id,
  coste_unitario: coste,
  precio_venta: precio,
  activa: true,
  repetida: false,
  ...extra,
});

describe("mediana", () => {
  it("impar, par (media de las dos centrales) y vacía", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBeNull();
    expect(mediana([Number.NaN])).toBeNull();
  });
});

describe("precioRecomendado", () => {
  it("con variantes del mismo producto, su relación precio/coste", () => {
    const r = precioRecomendado({ id: "nueva", producto_id: "p1", coste_unitario: 4 }, [
      m("a", "p1", 2, 5), // 2,5
      m("b", "p1", 3, 9), // 3
      m("c", "p2", 1, 10), // otro producto: no cuenta
    ]);
    expect(r).toEqual({ precio: 11, ratio: 2.75, fuente: "producto", muestras: 2 });
  });

  it("sin variantes del producto, cae al catálogo con al menos 3 muestras", () => {
    expect(MIN_MUESTRAS_CATALOGO).toBe(3);
    const r = precioRecomendado({ producto_id: "p9", coste_unitario: 2 }, [
      m("a", "p1", 2, 4), // 2
      m("b", "p2", 1, 3), // 3
      m("c", null, 4, 10), // 2,5
    ]);
    expect(r).toEqual({ precio: 5, ratio: 2.5, fuente: "catalogo", muestras: 3 });
  });

  it("sin producto (null) también va al catálogo", () => {
    const r = precioRecomendado({ producto_id: null, coste_unitario: 1 }, [
      m("a", null, 1, 2),
      m("b", null, 1, 2),
      m("c", null, 1, 2),
    ]);
    expect(r?.fuente).toBe("catalogo");
  });

  it("menos de 3 muestras en el catálogo → null (no se inventa)", () => {
    expect(
      precioRecomendado({ producto_id: "p9", coste_unitario: 2 }, [
        m("a", "p1", 2, 4),
        m("b", "p2", 1, 3),
      ]),
    ).toBeNull();
    expect(precioRecomendado({ producto_id: null, coste_unitario: 2 }, [])).toBeNull();
  });

  it("coste 0 o negativo → null", () => {
    const cat = [m("a", "p1", 2, 4), m("b", "p1", 2, 4), m("c", "p1", 2, 4)];
    expect(precioRecomendado({ producto_id: "p1", coste_unitario: 0 }, cat)).toBeNull();
    expect(precioRecomendado({ producto_id: "p1", coste_unitario: -1 }, cat)).toBeNull();
  });

  it("excluye inactivas, repetidas, la propia y las de precio o coste 0", () => {
    const cat = [
      m("objetivo", "p1", 2, 100),
      m("inactiva", "p1", 2, 100, { activa: false }),
      m("repetida", "p1", 2, 100, { repetida: true }),
      m("sin-precio", "p1", 2, 0),
      m("sin-coste", "p1", 0, 5),
      m("buena", "p1", 2, 5),
    ];
    expect(
      precioRecomendado({ id: "objetivo", producto_id: "p1", coste_unitario: 2 }, cat),
    ).toEqual({
      precio: 5,
      ratio: 2.5,
      fuente: "producto",
      muestras: 1,
    });
    // Sin la buena no queda ninguna del producto ni bastan para el catálogo.
    expect(
      precioRecomendado({ id: "objetivo", producto_id: "p1", coste_unitario: 2 }, cat.slice(0, 5)),
    ).toBeNull();
  });

  it("ratio a 4 decimales y precio al céntimo, sin redondeos comerciales", () => {
    const r = precioRecomendado({ producto_id: "p1", coste_unitario: 3.33 }, [m("a", "p1", 3, 7)]);
    // 7/3 = 2,333333… → 2,3333; 3,33 × 2,3333 = 7,769889 → 7,77.
    expect(r).toEqual({ precio: 7.77, ratio: 2.3333, fuente: "producto", muestras: 1 });
  });
});
