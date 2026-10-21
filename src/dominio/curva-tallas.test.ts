import { describe, expect, it } from "vitest";
import { curvaDeTallas, tonoStock } from "./curva-tallas";
import type { ProductoTextil, VarianteCatalogo } from "./tipos-textil";

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

/**
 * Como llegan hoy las compras de Roly: la referencia lleva la talla y el color,
 * y cada una es un producto distinto con la misma marca y el mismo nombre.
 */
function roly(referencia: string, nombre: string, extra: Partial<VarianteCatalogo>) {
  const producto: ProductoTextil = {
    id: `p-${referencia}`,
    marca: "Roly",
    referencia,
    nombre,
    categoria: null,
    activo: true,
  };
  return variante(`v-${referencia}`, { producto_id: producto.id, producto, nombre, ...extra });
}

// Las filas de la captura de Stock (21-10-2026).
const captura = [
  roly("SS643203011", "Antartida", {
    color: "BLANCO PERLA",
    talla: "L",
    cantidad: 1,
    cantidad_reservada: 1,
    coste_unitario: 12.55,
  }),
  roly("SS643201011", "Antartida", {
    color: "BLANCO PERLA",
    talla: "S",
    cantidad: 5,
    cantidad_reservada: 5,
    coste_unitario: 12.55,
  }),
  roly("SS64320205", "Antartida", {
    color: "ROYAL",
    talla: "M",
    cantidad: 1,
    cantidad_reservada: 1,
    coste_unitario: 12.55,
  }),
  roly("SS64320305", "Antartida", {
    color: "ROYAL",
    talla: "L",
    cantidad: 3,
    cantidad_reservada: 3,
    coste_unitario: 12.55,
  }),
  roly("SS643202011", "Antartida", {
    color: "BLANCO PERLA",
    talla: "M",
    cantidad: 1,
    cantidad_reservada: 1,
    coste_unitario: 12.55,
  }),
  roly("SS64320105", "Antartida", {
    color: "ROYAL",
    talla: "S",
    cantidad: 5,
    cantidad_reservada: 5,
    coste_unitario: 12.55,
  }),
  variante("v-tsra190", {
    nombre: "Camiseta mga/c, 100% alg, 190 gsm",
    color: "BK",
    talla: "L",
    cantidad: 3,
    coste_unitario: 2.92,
  }),
  roly("SU10700201", "Clasica", { color: "BLANCO", talla: "M", cantidad: 3, coste_unitario: 6.25 }),
  roly("SU10700601", "Clasica", {
    color: "BLANCO",
    talla: "3XL",
    cantidad: 1,
    coste_unitario: 6.83,
  }),
  roly("CA65020348", "Dogo Premium", {
    color: "ROSA CLARO",
    talla: "L",
    cantidad: 1,
    coste_unitario: 2.39,
  }),
  roly("CA65020601", "Dogo Premium", {
    color: "BLANCO",
    talla: "3XL",
    cantidad: 2,
    coste_unitario: 2.52,
  }),
  roly("CA65020201", "Dogo Premium", {
    color: "BLANCO",
    talla: "M",
    cantidad: 10,
    coste_unitario: 2.39,
  }),
];

describe("tonoStock", () => {
  it("rojo solo si hay más reservado que físico; ámbar en el mínimo o sin nada libre", () => {
    expect(tonoStock(-1, 0)).toBe("mal");
    expect(tonoStock(0, 0)).toBe("atencion");
    expect(tonoStock(2, 2)).toBe("atencion");
    expect(tonoStock(3, 2)).toBe("neutro");
    expect(tonoStock(1, 0)).toBe("neutro");
  });
});

describe("curvaDeTallas", () => {
  it("la captura: doce variantes en seis filas, con las tallas que hay en columnas", () => {
    const c = curvaDeTallas(captura);
    expect(c.tallas.map((t) => t.etiqueta)).toEqual(["S", "M", "L", "3XL"]);
    expect(c.filas.map((f) => [f.nombre, f.color])).toEqual([
      ["Antartida", "BLANCO PERLA"],
      ["Antartida", "ROYAL"],
      ["Camiseta mga/c, 100% alg, 190 gsm", "BK"],
      ["Clasica", "BLANCO"],
      ["Dogo Premium", "BLANCO"],
      ["Dogo Premium", "ROSA CLARO"],
    ]);
    const disponibles = c.filas.map((f) =>
      c.tallas.map((t) => f.casillas.get(t.clave)?.disponible ?? null),
    );
    expect(disponibles).toEqual([
      [0, 0, 0, null],
      [0, 0, 0, null],
      [null, null, 3, null],
      [null, 3, null, 1],
      [null, 10, null, 2],
      [null, null, 1, null],
    ]);
  });

  it("la fila suma sus tallas; todo reservado es ámbar, no rojo", () => {
    const [blancoPerla] = curvaDeTallas(captura).filas;
    expect(blancoPerla).toMatchObject({
      marca: "Roly",
      fisico: 7,
      reservado: 7,
      disponible: 0,
      tono: "atencion",
    });
    expect(blancoPerla.variantes.map((v) => v.talla)).toEqual(["S", "M", "L"]);
  });

  it("referencia común solo si todas la comparten", () => {
    const c = curvaDeTallas(captura);
    expect(c.filas[0].referencia).toBeNull();
    const gildan: ProductoTextil = {
      id: "p-g",
      marca: "Gildan",
      referencia: "5000",
      nombre: "Camiseta Heavy",
      categoria: "camiseta",
      activo: true,
    };
    const [f] = curvaDeTallas([
      variante("a", { producto_id: "p-g", producto: gildan, talla: "M", color: "Negro" }),
      variante("b", { producto_id: "p-g", producto: gildan, talla: "L", color: "negro" }),
    ]).filas;
    expect(f).toMatchObject({
      referencia: "5000",
      categoria: "camiseta",
      nombre: "Camiseta Heavy",
    });
  });

  it("el coste: uno si cuestan lo mismo; si no, del más bajo al más alto", () => {
    const filas = curvaDeTallas(captura).filas;
    expect(filas[0].coste).toEqual({ min: 12.55, max: 12.55 });
    expect(filas[3].coste).toEqual({ min: 6.25, max: 6.83 });
  });

  it("columnas en orden: adulto, niño, única y sin talla al final", () => {
    const c = curvaDeTallas([
      variante("u", { talla: "Talla única" }),
      variante("n", { talla: "3-4 años", nombre: "Infantil" }),
      variante("x", { talla: "XL" }),
      variante("s", { talla: "XS" }),
      variante("v", { talla: null, nombre: "Gorra" }),
      variante("n2", { talla: "9-10 años", nombre: "Infantil" }),
    ]);
    expect(c.tallas.map((t) => t.etiqueta)).toEqual([
      "XS",
      "XL",
      "3-4 años",
      "9-10 años",
      "Talla única",
      "Sin talla",
    ]);
  });

  it("XXL y 2XL son la misma columna, con el nombre que más se usa", () => {
    const c = curvaDeTallas([
      variante("a", { nombre: "A", talla: "XXL" }),
      variante("b", { nombre: "B", talla: "XXL" }),
      variante("c", { nombre: "C", talla: "2XL" }),
    ]);
    expect(c.tallas).toEqual([{ clave: "2XL", etiqueta: "XXL" }]);
  });

  it("una desactivada sin unidades sale en el detalle pero no abre columna", () => {
    const c = curvaDeTallas([
      variante("m", { talla: "M", cantidad: 2 }),
      variante("xs", { talla: "XS", activa: false }),
    ]);
    expect(c.tallas.map((t) => t.etiqueta)).toEqual(["M"]);
    expect(c.filas[0].variantes.map((v) => v.id)).toEqual(["xs", "m"]);
  });

  it("una desactivada con unidades sí cuenta: esas prendas existen", () => {
    const c = curvaDeTallas([variante("xs", { talla: "XS", activa: false, cantidad: 1 })]);
    expect(c.filas[0].casillas.get("XS")?.disponible).toBe(1);
  });

  it("dos fichas de la misma talla (repetidas) suman en una casilla, sin sumar mínimos", () => {
    const [f] = curvaDeTallas([
      variante("buena", { talla: "M", cantidad: 3, cantidad_minima: 2 }),
      variante("rep", { talla: "m", cantidad: 1, cantidad_minima: 2, repetida: true }),
    ]).filas;
    const m = f.casillas.get("M");
    expect(m?.variantes.map((v) => v.id)).toEqual(["buena", "rep"]);
    expect(m).toMatchObject({ fisico: 4, disponible: 4, minimo: 2, tono: "neutro" });
  });

  it("más reservado que físico: la casilla y la fila en rojo", () => {
    const [f] = curvaDeTallas([
      variante("s", { talla: "S", cantidad: 1, cantidad_reservada: 3 }),
      variante("m", { talla: "M", cantidad: 0 }),
    ]).filas;
    expect(f.casillas.get("S")?.tono).toBe("mal");
    expect(f.tono).toBe("mal");
  });

  it("quedarse filtra filas y las columnas salen solo de las que quedan", () => {
    const c = curvaDeTallas(captura, (f) => f.nombre === "Clasica");
    expect(c.filas).toHaveLength(1);
    expect(c.tallas.map((t) => t.etiqueta)).toEqual(["M", "3XL"]);
  });

  it("sin color va al final de su prenda", () => {
    const c = curvaDeTallas([
      variante("sin", { talla: "M" }),
      variante("negro", { talla: "M", color: "Negro" }),
    ]);
    expect(c.filas.map((f) => f.color)).toEqual(["Negro", null]);
  });

  it("sin productos (antes de la migración del escáner) agrupa por el nombre de la variante", () => {
    const c = curvaDeTallas([
      variante("a", { nombre: "Sudadera", talla: "M", color: "Gris" }),
      variante("b", { nombre: "sudadera ", talla: "L", color: "gris" }),
    ]);
    expect(c.filas).toHaveLength(1);
    expect(c.filas[0].marca).toBeNull();
  });
});
