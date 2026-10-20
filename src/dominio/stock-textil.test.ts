import { describe, expect, it } from "vitest";
import {
  ORDEN_TALLAS,
  agruparPorProducto,
  aVarianteCatalogo,
  buscarProductos,
  compararTallas,
  disponible,
  etiquetaVariante,
  lineasDesdeStock,
  margenPrevisto,
  rejillaProducto,
  reservadoPorVariante,
} from "./stock-textil";
import type { ProductoTextil, VarianteCatalogo } from "./tipos-textil";

const gildan: ProductoTextil = {
  id: "p-gildan",
  marca: "Gildan",
  referencia: "5000",
  nombre: "Camiseta Heavy",
  categoria: "camiseta",
  activo: true,
};
const bc: ProductoTextil = {
  id: "p-bc",
  marca: "B&C",
  referencia: "E190",
  nombre: "Camiseta Exact",
  categoria: "camiseta",
  activo: true,
};

function variante(id: string, extra: Partial<VarianteCatalogo> = {}): VarianteCatalogo {
  return {
    id,
    producto_id: null,
    producto: null,
    nombre: "Camiseta",
    sku: null,
    ean: null,
    color: null,
    talla: null,
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
const de = (p: ProductoTextil, id: string, extra: Partial<VarianteCatalogo> = {}) =>
  variante(id, { producto_id: p.id, producto: p, nombre: p.nombre, ...extra });

describe("compararTallas", () => {
  it("conocidas, números, única, el resto y vacías al final", () => {
    expect(["XL", "S", "2XL", "M", "38", "36", "UNICA", ""].sort(compararTallas)).toEqual([
      "S",
      "M",
      "XL",
      "2XL",
      "36",
      "38",
      "UNICA",
      "",
    ]);
  });

  it("compara por la clave: «xxl» va con «2XL» y los números son números", () => {
    expect(compararTallas("xxl", "2XL")).toBe(0);
    expect(compararTallas("9", "10")).toBeLessThan(0);
    expect(["T.U.", "Talla L", null, "XS", "zz", "aa"].sort(compararTallas)).toEqual([
      "XS",
      "Talla L",
      "T.U.",
      "aa",
      "zz",
      null,
    ]);
    expect(ORDEN_TALLAS[0]).toBe("3XS");
    expect(ORDEN_TALLAS.at(-1)).toBe("5XL");
  });
});

describe("aVarianteCatalogo", () => {
  it("fila vieja, sin producto, ean ni repetida, con números como texto", () => {
    const v = aVarianteCatalogo({
      id: "s1",
      nombre: "Polo Piqué",
      sku: "",
      color: "Azul",
      talla: "M",
      cantidad: "5",
      cantidad_reservada: "2",
      cantidad_minima: null,
      coste_unitario: "3.25",
      precio_venta: "9.9",
      activa: true,
    });
    expect(v).toEqual({
      id: "s1",
      producto_id: null,
      producto: null,
      nombre: "Polo Piqué",
      sku: null,
      ean: null,
      color: "Azul",
      talla: "M",
      categoria: null,
      cantidad: 5,
      cantidad_reservada: 2,
      cantidad_minima: 0,
      coste_unitario: 3.25,
      precio_venta: 9.9,
      activa: true,
      repetida: false,
    });
  });

  it("fila nueva con el producto anidado (también como textil_productos o en array)", () => {
    const fila = {
      id: "s2",
      producto_id: "p-gildan",
      nombre: "Camiseta Heavy",
      ean: "4006381333931",
      repetida: true,
      activa: false,
    };
    const a = aVarianteCatalogo({ ...fila, producto: gildan });
    const b = aVarianteCatalogo({ ...fila, textil_productos: [gildan] });
    expect(a.producto).toEqual(gildan);
    expect(b.producto).toEqual(gildan);
    expect(a).toMatchObject({ ean: "4006381333931", repetida: true, activa: false });
  });

  it("sin activa, la variante cuenta como activa", () => {
    expect(aVarianteCatalogo({ id: "s3" }).activa).toBe(true);
    expect(aVarianteCatalogo({ id: "s3", cantidad: "abc" }).cantidad).toBe(0);
  });
});

describe("etiquetaVariante y disponible", () => {
  it("marca · nombre · color · talla, sin vacíos", () => {
    expect(etiquetaVariante(de(gildan, "a", { color: "Negro", talla: "XL" }))).toBe(
      "Gildan · Camiseta Heavy · Negro · XL",
    );
    expect(etiquetaVariante(variante("b", { color: " " }))).toBe("Camiseta");
  });

  it("disponible = físico − reservado (+ lo que reserva el propio pedido)", () => {
    const v = { cantidad: 10, cantidad_reservada: 4 };
    expect(disponible(v)).toBe(6);
    expect(disponible(v, 3)).toBe(9);
    expect(disponible({ cantidad: 1, cantidad_reservada: 3 })).toBe(-2);
  });
});

describe("agruparPorProducto y buscarProductos", () => {
  const catalogo = [
    de(gildan, "g-n-m", { color: "Negro", talla: "M", cantidad: 5, cantidad_reservada: 1 }),
    de(gildan, "g-n-s", { color: "Negro", talla: "S", cantidad: 2, ean: "4006381333931" }),
    de(gildan, "g-b-xl", { color: "Blanco", talla: "XL", cantidad: 1, sku: "G5000-WH-XL" }),
    de(gildan, "g-old", { color: "Blanco", talla: "L", activa: false, cantidad: 9 }),
    de(bc, "bc-r-m", { color: "Rojo", talla: "M", cantidad: 3, cantidad_reservada: 3 }),
    variante("viejo-1", { nombre: "Polo Piqué", color: "Azul", talla: "M", cantidad: 2 }),
    variante("viejo-2", { nombre: "polo pique", color: "Azul", talla: "L", cantidad: 1 }),
    variante("viejo-3", { nombre: "Polo Piqué", color: "Azul", talla: "M", repetida: true }),
  ];

  it("sin migración agrupa por nombre normalizado; fuera inactivas y repetidas", () => {
    const grupos = agruparPorProducto(catalogo);
    expect(grupos.map((g) => g.clave)).toEqual(["n:polopique", "p-bc", "p-gildan"]);
    const polo = grupos[0];
    expect(polo.variantes.map((v) => v.id)).toEqual(["viejo-1", "viejo-2"]);
    expect(polo).toMatchObject({ producto_id: null, marca: null, nombre: "Polo Piqué", fisico: 3 });
    const g = grupos.find((x) => x.clave === "p-gildan")!;
    expect(g.variantes.map((v) => v.id)).toEqual(["g-b-xl", "g-n-s", "g-n-m"]);
    expect(g).toMatchObject({
      fisico: 8,
      reservado: 1,
      disponible: 7,
      marca: "Gildan",
      referencia: "5000",
    });
  });

  it("con incluirInactivas salen todas", () => {
    const grupos = agruparPorProducto(catalogo, { incluirInactivas: true });
    expect(grupos.flatMap((g) => g.variantes)).toHaveLength(catalogo.length);
  });

  it("busca por marca, referencia, SKU, color y varias palabras", () => {
    const grupos = agruparPorProducto(catalogo);
    expect(buscarProductos(grupos, "gildan").map((g) => g.clave)).toEqual(["p-gildan"]);
    expect(buscarProductos(grupos, "E-190").map((g) => g.clave)).toEqual(["p-bc"]);
    expect(buscarProductos(grupos, "g5000wh").map((g) => g.clave)).toEqual(["p-gildan"]);
    expect(buscarProductos(grupos, "rojo").map((g) => g.clave)).toEqual(["p-bc"]);
    expect(buscarProductos(grupos, "camiseta negro").map((g) => g.clave)).toEqual(["p-gildan"]);
    expect(buscarProductos(grupos, "piqué").map((g) => g.clave)).toEqual(["n:polopique"]);
    expect(buscarProductos(grupos, "nada que ver")).toEqual([]);
    expect(buscarProductos(grupos, "  ")).toHaveLength(3);
  });

  it("un EAN válido pone su producto el primero", () => {
    const grupos = agruparPorProducto(catalogo);
    expect(buscarProductos(grupos, "4006 3813 3393 1")[0].clave).toBe("p-gildan");
  });
});

describe("rejillaProducto", () => {
  it("colores × tallas ordenadas, con huecos y disponible con lo reservado propio", () => {
    const [g] = agruparPorProducto([
      de(gildan, "n-m", { color: "Negro", talla: "M", cantidad: 5, cantidad_reservada: 2 }),
      de(gildan, "n-xl", { color: "Negro", talla: "XL", cantidad: 1 }),
      de(gildan, "b-s", { color: "Blanco", talla: "S", cantidad: 4 }),
      de(gildan, "sin", { color: null, talla: null, cantidad: 1 }),
    ]);
    const r = rejillaProducto(g, new Map([["n-m", 2]]));
    expect(r.colores).toEqual([
      { clave: "blanco", etiqueta: "Blanco" },
      { clave: "negro", etiqueta: "Negro" },
      { clave: "", etiqueta: "Sin color" },
    ]);
    expect(r.tallas.map((t) => t.etiqueta)).toEqual(["S", "M", "XL", "Sin talla"]);
    expect(r.celdas.map((fila) => fila.map((c) => c?.variante.id ?? null))).toEqual([
      ["b-s", null, null, null],
      [null, "n-m", "n-xl", null],
      [null, null, null, "sin"],
    ]);
    expect(r.celdas[1][1]).toMatchObject({ fisico: 5, reservado: 2, disponible: 5 });
    expect(r.celdas[1][2]).toMatchObject({ disponible: 1 });
  });

  it("dos variantes en la misma celda: manda la utilizable", () => {
    const [g] = agruparPorProducto(
      [
        de(gildan, "vieja", { color: "Negro", talla: "M", activa: false }),
        de(gildan, "buena", { color: "negro", talla: "m" }),
      ],
      { incluirInactivas: true },
    );
    const r = rejillaProducto(g);
    expect(r.celdas).toHaveLength(1);
    expect(r.celdas[0][0]?.variante.id).toBe("buena");
  });
});

describe("reservadoPorVariante y lineasDesdeStock", () => {
  it("suma por variante e ignora líneas sin variante o sin cantidad", () => {
    const m = reservadoPorVariante([
      { stock_id: "a", cantidad: 2 },
      { stock_id: "a", cantidad: "3" },
      { stock_id: null, cantidad: 5 },
      { stock_id: "b", cantidad: 0 },
      { cantidad: 1 },
    ]);
    expect([...m.entries()]).toEqual([["a", 5]]);
  });

  it("una línea por variante; sin precio de venta, 0 (no se inventa)", () => {
    const lineas = lineasDesdeStock(
      [
        de(gildan, "a", { color: "Negro", talla: "M", precio_venta: 7.5 }),
        de(gildan, "b", { color: "Negro", talla: "L", precio_venta: 0 }),
      ],
      new Map([["b", 4]]),
    );
    expect(lineas).toEqual([
      {
        descripcion: "Gildan · Camiseta Heavy · Negro · M",
        cantidad: 1,
        precio_unitario: 7.5,
        iva_pct: 21,
        stock_id: "a",
      },
      {
        descripcion: "Gildan · Camiseta Heavy · Negro · L",
        cantidad: 4,
        precio_unitario: 0,
        iva_pct: 21,
        stock_id: "b",
      },
    ]);
  });
});

describe("margenPrevisto", () => {
  it("solo con las líneas de coste conocido; las demás se cuentan aparte", () => {
    const m = margenPrevisto([
      { cantidad: 10, precio_unitario: 8, coste_unitario: 3.5 },
      { cantidad: 2, precio_unitario: 12.5, coste_unitario: null },
      { cantidad: 1, precio_unitario: 4, coste_unitario: 0 },
    ]);
    expect(m).toEqual({
      base: 80,
      coste: 35,
      margen: 45,
      porcentaje: 56.3,
      lineasSinCoste: 2,
      baseSinCoste: 29,
    });
  });

  it("sin líneas con coste: porcentaje null (no 0 %)", () => {
    const m = margenPrevisto([{ cantidad: 1, precio_unitario: 5, coste_unitario: null }]);
    expect(m).toMatchObject({ base: 0, coste: 0, margen: 0, porcentaje: null, lineasSinCoste: 1 });
    expect(margenPrevisto([])).toMatchObject({ base: 0, porcentaje: null, lineasSinCoste: 0 });
  });

  it("vender por debajo del coste da margen negativo", () => {
    const m = margenPrevisto([{ cantidad: 3, precio_unitario: 2, coste_unitario: 2.333333 }]);
    expect(m).toMatchObject({ base: 6, coste: 7, margen: -1, porcentaje: -16.7 });
  });
});
