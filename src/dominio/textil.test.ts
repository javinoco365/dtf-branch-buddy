import { describe, expect, it } from "vitest";
import { costePorPedido, productosTextil, resumenStock } from "./textil";

describe("productos textil", () => {
  it("agrupa por descripción sin distinguir mayúsculas ni espacios", () => {
    const p = productosTextil([
      { descripcion: "Camiseta  blanca", cantidad: 10, subtotal: 50 },
      { descripcion: "camiseta blanca", cantidad: 5, subtotal: 25 },
      { descripcion: "Sudadera", cantidad: 2, subtotal: 60 },
    ]);
    expect(p).toEqual([
      { nombre: "Camiseta  blanca", unidades: 15, importe: 75 },
      { nombre: "Sudadera", unidades: 2, importe: 60 },
    ]);
  });
});

describe("almacén", () => {
  it("valor a coste medio, reservas y lo que está en el mínimo o por debajo", () => {
    const a = (id: string, cantidad: number, minima: number, coste: number, activa = true) => ({
      id,
      nombre: id,
      cantidad,
      cantidad_minima: minima,
      cantidad_reservada: 1,
      coste_unitario: coste,
      activa,
    });
    const r = resumenStock([
      a("a", 10, 5, 2),
      a("b", 3, 5, 4),
      a("c", 5, 5, 1),
      a("x", 100, 0, 9, false),
    ]);
    expect(r).toMatchObject({ articulos: 3, unidades: 18, valor: 37, reservadas: 3 });
    expect(r.bajoMinimo.map((x) => [x.id, x.faltan])).toEqual([
      ["b", 2],
      ["c", 0],
    ]);
  });
});

describe("coste de lo vendido", () => {
  it("salidas por venta menos devoluciones del cliente, al coste congelado", () => {
    const c = costePorPedido([
      { textil_pedido_id: "p1", motivo: "venta", cantidad: -10, coste_unitario: 3 },
      { textil_pedido_id: "p1", motivo: "devolucion_cliente", cantidad: 2, coste_unitario: 3 },
      { textil_pedido_id: "p2", motivo: "venta", cantidad: -1, coste_unitario: 7.5 },
      { textil_pedido_id: "p2", motivo: "ajuste_inventario", cantidad: -5, coste_unitario: 7.5 },
      { textil_pedido_id: null, motivo: "compra", cantidad: 50, coste_unitario: 3 },
    ]);
    expect([...c.entries()]).toEqual([
      ["p1", 24],
      ["p2", 7.5],
    ]);
  });
});
