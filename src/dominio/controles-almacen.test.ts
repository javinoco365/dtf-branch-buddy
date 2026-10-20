import { describe, expect, it } from "vitest";
import {
  controlComprasEntradas,
  resumenControles,
  type CompraControl,
  type EntradaControl,
} from "./controles-almacen";

const compra = (
  id: string,
  base: number | string,
  extra: Partial<CompraControl> = {},
): CompraControl => ({
  id,
  numero: `F-${id}`,
  proveedor: "Textiles Sur",
  fecha: "2026-10-01",
  base,
  categoria: "textil",
  estado: "registrada",
  borrada_en: null,
  ...extra,
});
const entrada = (
  compra_id: string | null,
  cantidad: number,
  coste: number,
  motivo: EntradaControl["motivo"] = "compra",
): EntradaControl => ({
  compra_id,
  cantidad,
  coste_unitario: coste,
  motivo,
});

describe("controlComprasEntradas", () => {
  const compras = [
    compra("cuadra", "105.00"),
    compra("centimo", 50, { fecha: "2026-09-01" }),
    compra("sin-enlace", 30),
    compra("borrada", 10, { borrada_en: "2026-10-02T10:00:00Z" }),
    compra("otros", 99, { categoria: "consumibles" }),
    compra("borrador", 20, { estado: "borrador" }),
    compra("sin-categoria", 12, { categoria: null }),
  ];
  const entradas = [
    entrada("cuadra", 6, 10.5),
    entrada("cuadra", 4, 10.5),
    entrada("centimo", 3, 16.67), // 50,01
    entrada("borrada", 1, 10),
    entrada("otros", 1, 99),
    entrada("sin-categoria", 4, 3),
    entrada("sin-enlace", -1, 5, "venta"), // no es entrada de compra
    entrada(null, 1, 30), // compra sin enlace
  ];

  it("una que cuadra, una con 0,01, una sin enlace; borradas, borradores y no textil fuera", () => {
    const c = controlComprasEntradas(compras, entradas);
    expect(c.filas.map((f) => [f.compra.id, f.estado, f.diferencia])).toEqual([
      ["centimo", "descuadre", 0.01],
      ["sin-enlace", "sin_enlace", -30],
      ["cuadra", "cuadra", 0],
      ["sin-categoria", "cuadra", 0],
    ]);
    expect(c.revisadas).toBe(4);
    expect(c.descuadres).toBe(1);
    expect(c.sinEnlace).toBe(1);
    expect(c.diferenciaTotal).toBe(0.01);
    expect(c.filas[2]).toMatchObject({ base: 105, entradas: 105 });
  });

  it("sin descuadres, diferencia 0 aunque haya una sin enlace", () => {
    const c = controlComprasEntradas([compra("a", 10), compra("b", 5)], [entrada("a", 2, 5)]);
    expect(c.descuadres).toBe(0);
    expect(c.sinEnlace).toBe(1);
    expect(c.diferenciaTotal).toBe(0);
  });

  it("lista vacía", () => {
    expect(controlComprasEntradas([], [])).toEqual({
      filas: [],
      revisadas: 0,
      descuadres: 0,
      sinEnlace: 0,
      diferenciaTotal: 0,
    });
  });
});

describe("resumenControles", () => {
  const limpio = controlComprasEntradas([compra("a", 10)], [entrada("a", 1, 10)]);
  const sucio = controlComprasEntradas([compra("a", 10)], [entrada("a", 1, 10.01)]);

  it("todo en cero", () => {
    expect(resumenControles(limpio, 0, 0)).toEqual({
      comprasConDescuadre: 0,
      diferenciaCompras: 0,
      comprasSinEnlace: 0,
      variantesDescuadradas: 0,
      reservasDescuadradas: 0,
      diferenciaValorCache: null,
      todoEnCero: true,
    });
  });

  it("una compra descuadrada, una variante o una reserva: no está en cero", () => {
    expect(resumenControles(sucio, 0, 0).todoEnCero).toBe(false);
    expect(resumenControles(sucio, 0, 0).diferenciaCompras).toBe(0.01);
    expect(resumenControles(limpio, 1, 0).todoEnCero).toBe(false);
    expect(resumenControles(limpio, 0, 2).todoEnCero).toBe(false);
  });

  it("«no comprobado» no es «en cero»: null en variantes, reservas o compras", () => {
    expect(resumenControles(limpio, null, 0).todoEnCero).toBe(false);
    expect(resumenControles(limpio, 0, null).todoEnCero).toBe(false);
    expect(resumenControles(null, 0, 0).todoEnCero).toBe(false);
  });

  it("la diferencia de valor de la caché es informativa: no cambia todoEnCero", () => {
    const r = resumenControles(limpio, 0, 0, 0.034);
    expect(r.diferenciaValorCache).toBe(0.03);
    expect(r.todoEnCero).toBe(true);
    expect(resumenControles(sucio, 0, 0, 0).todoEnCero).toBe(false);
  });
});
