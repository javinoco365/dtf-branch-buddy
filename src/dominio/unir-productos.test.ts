import { describe, expect, it } from "vitest";
import { propuestasDeUnion } from "./unir-productos";
import type { ProductoTextil, VarianteCatalogo } from "./tipos-textil";

function producto(id: string, extra: Partial<ProductoTextil> = {}): ProductoTextil {
  return {
    id,
    marca: "Roly",
    referencia: id.toUpperCase(),
    nombre: "Antartida",
    categoria: null,
    activo: true,
    ...extra,
  };
}

function variante(
  id: string,
  p: ProductoTextil,
  extra: Partial<VarianteCatalogo> = {},
): VarianteCatalogo {
  return {
    id,
    producto_id: p.id,
    producto: p,
    nombre: p.nombre,
    sku: null,
    ean: null,
    color: "BLANCO PERLA",
    talla: "M",
    categoria: null,
    cantidad: 0,
    cantidad_reservada: 0,
    cantidad_minima: 0,
    coste_unitario: 0,
    precio_venta: 0,
    activa: true,
    repetida: false,
    ...extra,
  };
}

describe("propuestasDeUnion", () => {
  it("la Antartida en tres productos: una propuesta, con dos que pasan al que se queda", () => {
    const a = producto("ss643201011");
    const b = producto("ss643202011");
    const c = producto("ss64320105", { marca: "ROLY", nombre: "antartida" });
    const [p, ...resto] = propuestasDeUnion([
      variante("v1", a, { talla: "S" }),
      variante("v2", b, { talla: "M" }),
      variante("v3", c, { color: "ROYAL", talla: "S" }),
    ]);
    expect(resto).toEqual([]);
    expect(p.destino.id).toBe("ss643201011");
    expect(p.origenes.map((o) => o.id).sort()).toEqual(["ss643202011", "ss64320105"].sort());
    expect(p).toMatchObject({ marca: "Roly", nombre: "Antartida", variantes: 2, choques: [] });
  });

  it("se queda el que no tiene referencia; si no hay, el de más variantes", () => {
    const sin = producto("p-sin", { referencia: null });
    const grande = producto("p-grande");
    const otro = producto("p-otro");
    const [p1] = propuestasDeUnion([
      variante("a", grande, { talla: "S" }),
      variante("b", grande, { talla: "M" }),
      variante("c", sin, { talla: "L" }),
    ]);
    expect(p1.destino.id).toBe("p-sin");
    const [p2] = propuestasDeUnion([
      variante("a", otro, { talla: "XL" }),
      variante("b", grande, { talla: "S" }),
      variante("c", grande, { talla: "M" }),
    ]);
    expect(p2.destino.id).toBe("p-grande");
    expect(p2.variantes).toBe(1);
  });

  it("la misma talla y color en dos productos es un choque; una repetida o desactivada, no", () => {
    const a = producto("a");
    const b = producto("b");
    const [p] = propuestasDeUnion([
      variante("a-m", a, { talla: "M" }),
      variante("b-m", b, { talla: "m", color: "Blanco Perla" }),
      variante("a-l", a, { talla: "L" }),
      variante("b-l", b, { talla: "L", repetida: true }),
      variante("b-s", b, { talla: "S", activa: false }),
      variante("a-s", a, { talla: "S" }),
    ]);
    expect(p.choques).toEqual([{ color: "BLANCO PERLA", talla: "M" }]);
    // Todas las variantes del que se va pasan, también la repetida y la desactivada.
    expect(p.variantes).toBe(3);
  });

  it("sin marca, con otro nombre, desactivados o solos: nada que proponer", () => {
    const sinMarca1 = producto("x1", { marca: null, nombre: "Camiseta" });
    const sinMarca2 = producto("x2", { marca: null, nombre: "Camiseta" });
    const dogo = producto("d", { nombre: "Dogo Premium" });
    const apagado = producto("off", { activo: false });
    const solo = producto("solo");
    expect(
      propuestasDeUnion([
        variante("1", sinMarca1),
        variante("2", sinMarca2, { talla: "L" }),
        variante("3", dogo),
        variante("4", apagado, { talla: "XL" }),
        variante("5", solo, { talla: "S" }),
      ]),
    ).toEqual([]);
  });

  it("una variante sin producto (antes de la migración del escáner) no cuenta", () => {
    const v = variante("v", producto("p"));
    expect(propuestasDeUnion([{ ...v, producto: null, producto_id: null }])).toEqual([]);
  });

  it("por marca y nombre, en orden", () => {
    const props = propuestasDeUnion([
      variante("1", producto("z1", { nombre: "Zeta" })),
      variante("2", producto("z2", { nombre: "Zeta" }), { talla: "L" }),
      variante("3", producto("a1", { nombre: "Alfa" })),
      variante("4", producto("a2", { nombre: "Alfa" }), { talla: "L" }),
    ]);
    expect(props.map((p) => p.nombre)).toEqual(["Alfa", "Zeta"]);
  });
});
