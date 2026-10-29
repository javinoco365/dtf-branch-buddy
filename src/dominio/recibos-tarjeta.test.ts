import { describe, expect, it } from "vitest";
import { desgloseDeRecibo, desgloseRecibos, type MovimientoTarjeta } from "./recibos-tarjeta";

let n = 0;
const compra = (fecha: string, importe: number, concepto = "Comercio"): MovimientoTarjeta => ({
  id: `c${String(++n).padStart(3, "0")}`,
  fecha,
  concepto,
  importe: -importe,
  es_recibo: false,
});
const recibo = (fecha: string, importe: number): MovimientoTarjeta => ({
  id: `r${fecha}`,
  fecha,
  concepto: "RECIBO MES ANTERIOR",
  importe,
  es_recibo: true,
});

describe("desgloseRecibos", () => {
  // La forma de los recibos reales de agosto a octubre, con importes de ejemplo.
  const movs = [
    compra("2026-07-22", 20),
    compra("2026-07-31", 30),
    recibo("2026-08-05", 50),
    compra("2026-08-03", 100),
    compra("2026-08-26", 25.5),
    recibo("2026-09-05", 125.5),
    compra("2026-08-31", 10),
    compra("2026-09-04", 40.25),
    compra("2026-09-08", 9.75),
    recibo("2026-10-05", 60),
    compra("2026-10-10", 70),
  ];

  it("cada recibo, las compras pendientes más antiguas hasta su importe", () => {
    const d = desgloseRecibos(movs);
    expect(d.map((x) => x.cuadra)).toEqual([true, true, true]);
    expect(d[0].compras.map((c) => c.fecha)).toEqual(["2026-07-22", "2026-07-31"]);
    expect(d[1].compras.map((c) => c.fecha)).toEqual(["2026-08-03", "2026-08-26"]);
    expect(d[2].compras.map((c) => c.fecha)).toEqual(["2026-08-31", "2026-09-04", "2026-09-08"]);
  });

  it("si el extracto empieza a mitad de periodo, se salta las compras de un recibo que no está", () => {
    const d = desgloseRecibos([compra("2026-06-28", 99), ...movs]);
    expect(d[0].cuadra).toBe(true);
    expect(d[0].compras.map((c) => c.fecha)).toEqual(["2026-07-22", "2026-07-31"]);
  });

  it("una devolución resta de su recibo", () => {
    const d = desgloseRecibos([
      compra("2026-09-01", 50),
      { ...compra("2026-09-02", 0), importe: 10, concepto: "Devolución" },
      recibo("2026-10-05", 40),
    ]);
    expect(d[0]).toMatchObject({ cuadra: true, diferencia: 0 });
    expect(d[0].compras).toHaveLength(2);
  });

  it("un recibo que no cuadra dice cuánto falta o sobra y no reparte nada", () => {
    const d = desgloseRecibos([compra("2026-09-01", 50), recibo("2026-10-05", 52.3)]);
    expect(d[0].cuadra).toBe(false);
    expect(d[0].diferencia).toBe(2.3);
  });

  it("el desglose de un recibo concreto", () => {
    expect(desgloseDeRecibo(movs, "r2026-09-05")?.compras).toHaveLength(2);
    expect(desgloseDeRecibo(movs, "no-existe")).toBeNull();
  });
});
