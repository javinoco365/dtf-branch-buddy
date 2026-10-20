import { describe, expect, it } from "vitest";
import {
  controlComprasEntradas,
  resumenControles,
  type CompraControl,
  type EntradaControl,
} from "./controles-almacen";
import type { RegularizacionStock, ResumenCasado } from "./tipos-textil";

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
      proformasSinFactura: 0,
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
      proformasSinFactura: 0,
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

describe("controles con proformas", () => {
  const stockRes = (extra: Partial<RegularizacionStock>): RegularizacionStock => ({
    variantes: [],
    entran: 0,
    salen: 0,
    valor_proforma: 0,
    valor_entradas: 0,
    valor_devoluciones: 0,
    importe_ajustes: 0,
    diferencia_sin_aplicar: 0,
    movimientos: 0,
    ...extra,
  });
  const casado = (stock: Partial<RegularizacionStock>): ResumenCasado => ({
    proforma_id: "p",
    stock: stockRes(stock),
    pago: {
      enlaces_movidos: 0,
      grupos: 0,
      grupos_revisar: 0,
      estado_pago: "pendiente",
      fecha_pago: null,
    },
  });
  const proforma = compra("p", 50, { tipo_documento: "proforma", fecha: "2026-09-20" });
  const ajuste = (compra_id: string, importe: number): EntradaControl => ({
    compra_id,
    cantidad: 0,
    coste_unitario: 0,
    motivo: "ajuste_coste",
    importe_ajuste: importe,
  });
  // P = 10 a 5 €; F = 12 a 6 €, 8 vendidas: entran 2 (12 €), ajuste 2 €, sin aplicar 8 €.
  const entradas = [entrada("p", 10, 5), entrada("f", 2, 6), ajuste("f", 2)];

  it("el par cuadra con lo que no se pudo aplicar, en una sola fila", () => {
    const factura = compra("f", 72, {
      tipo_documento: "factura",
      proforma_id: "p",
      casado_resumen: casado({ diferencia_sin_aplicar: 8 }),
    });
    const r = controlComprasEntradas([factura, proforma], entradas);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({
      tipo: "par",
      compra: { id: "f" },
      proforma: { id: "p" },
      base: 72,
      entradas: 64,
      sinAplicar: 8,
      diferencia: 0,
      estado: "cuadra",
    });
    expect(r.proformasSinFactura).toBe(0);
    expect(resumenControles(r, 0, 0).todoEnCero).toBe(true);
  });

  it("el par cuenta las salidas de la regularización", () => {
    const factura = compra("f", 35, {
      tipo_documento: "factura",
      proforma_id: "p",
      casado_resumen: casado({ valor_devoluciones: -15 }),
    });
    const r = controlComprasEntradas([factura, proforma], [entrada("p", 10, 5)]);
    expect(r.filas[0]).toMatchObject({
      tipo: "par",
      entradas: 35,
      diferencia: 0,
      estado: "cuadra",
    });
  });

  it("un par que no cuadra es un descuadre", () => {
    const factura = compra("f", 72, {
      tipo_documento: "factura",
      proforma_id: "p",
      casado_resumen: casado({ diferencia_sin_aplicar: 7 }),
    });
    const r = controlComprasEntradas([factura, proforma], entradas);
    expect(r.filas[0]).toMatchObject({ tipo: "par", diferencia: -1, estado: "descuadre" });
    expect(r.descuadres).toBe(1);
  });

  it("sin casado_resumen, sinAplicar 0", () => {
    const factura = compra("f", 64, { tipo_documento: "factura", proforma_id: "p" });
    const r = controlComprasEntradas([factura, proforma], entradas);
    expect(r.filas[0]).toMatchObject({ sinAplicar: 0, diferencia: 0, estado: "cuadra" });
  });

  it("una proforma sin factura se comprueba sola y no rompe todoEnCero", () => {
    const r = controlComprasEntradas(
      [proforma, compra("x", 10)],
      [entrada("p", 10, 5), entrada("x", 1, 10)],
    );
    expect(r.filas.map((f) => [f.compra.id, f.tipo, f.estado])).toEqual([
      ["x", "compra", "cuadra"],
      ["p", "proforma_sin_factura", "cuadra"],
    ]);
    expect(r.proformasSinFactura).toBe(1);
    const resumen = resumenControles(r, 0, 0);
    expect(resumen.proformasSinFactura).toBe(1);
    expect(resumen.todoEnCero).toBe(true);
  });
});
