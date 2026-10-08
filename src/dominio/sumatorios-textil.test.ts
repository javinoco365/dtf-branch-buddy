import { describe, expect, it } from "vitest";
import { resumenStock } from "./textil";
import { totalesMovimientosStock, totalesPresupuestos, totalesStock } from "./sumatorios-textil";

describe("totalesPresupuestos", () => {
  it("los rechazados no suman y se cuentan aparte", () => {
    const t = totalesPresupuestos([
      { estado: "enviado", total: "100.10" },
      { estado: "aceptado", total: 50.2 },
      { estado: "rechazado", total: 999 },
      { estado: "borrador", total: null },
    ]);
    expect(t).toEqual({ presupuestos: 3, rechazados: 1, total: 150.3 });
  });

  it("una lista vacía suma cero", () => {
    expect(totalesPresupuestos([])).toEqual({ presupuestos: 0, rechazados: 0, total: 0 });
  });
});

describe("totalesStock", () => {
  it("suma unidades con su signo y valora a coste sin los negativos", () => {
    const t = totalesStock([
      { cantidad: 10, cantidad_reservada: 3, coste_unitario: "2.5" },
      { cantidad: "-2", cantidad_reservada: null, coste_unitario: 4 },
      { cantidad: 1, coste_unitario: 0.1 },
    ]);
    expect(t).toEqual({ variantes: 3, fisico: 9, reservado: 3, disponible: 6, valor: 25.1 });
  });

  it("cuenta también las desactivadas: tiene que cuadrar con las filas", () => {
    const filas = [
      {
        id: "a",
        nombre: "A",
        cantidad: 5,
        cantidad_minima: 0,
        cantidad_reservada: 0,
        coste_unitario: 2,
      },
      {
        id: "b",
        nombre: "B",
        cantidad: 4,
        cantidad_minima: 0,
        cantidad_reservada: 0,
        coste_unitario: 1,
        activa: false,
      },
    ];
    expect(totalesStock(filas).valor).toBe(14);
    // El resumen de Gerencia solo mira las activas: por eso no se usa aquí.
    expect(resumenStock(filas).valor).toBe(10);
  });

  it("el valor coincide con el de Gerencia cuando todas están activas", () => {
    const filas = [
      {
        id: "a",
        nombre: "A",
        cantidad: 3,
        cantidad_minima: 0,
        cantidad_reservada: 1,
        coste_unitario: 1.1,
      },
      {
        id: "b",
        nombre: "B",
        cantidad: -1,
        cantidad_minima: 0,
        cantidad_reservada: 0,
        coste_unitario: 9,
      },
    ];
    expect(totalesStock(filas).valor).toBe(resumenStock(filas).valor);
    expect(totalesStock(filas).fisico).toBe(resumenStock(filas).unidades);
  });
});

describe("totalesMovimientosStock", () => {
  it("entradas y salidas por separado, y el saldo", () => {
    const t = totalesMovimientosStock([
      { cantidad: 20 },
      { cantidad: "-3" },
      { cantidad: -2 },
      { cantidad: 1 },
      { cantidad: 0 },
    ]);
    expect(t).toEqual({ movimientos: 5, entradas: 21, salidas: 5, saldo: 16, recortada: false });
  });

  it("si llegan tantos como el límite del servidor, la lista está recortada", () => {
    const movs = Array.from({ length: 200 }, () => ({ cantidad: 1 }));
    expect(totalesMovimientosStock(movs, 200).recortada).toBe(true);
    expect(totalesMovimientosStock(movs.slice(1), 200).recortada).toBe(false);
    expect(totalesMovimientosStock(movs).recortada).toBe(false);
  });
});
