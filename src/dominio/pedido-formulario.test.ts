import { describe, expect, it } from "vitest";
import {
  escribirNumero,
  leerNumeroEscrito,
  leerPedidoEscrito,
  lineaEnBlanco,
  lineasParaTotales,
  type LineaEscrita,
} from "./pedido-formulario";

const linea = (c: Partial<LineaEscrita> = {}): LineaEscrita => ({
  descripcion: "DTF",
  cantidad: "1",
  precio_unitario: "10",
  iva_rate: "21",
  linea: "dtf",
  ...c,
});

describe("leerNumeroEscrito", () => {
  it("con coma o con punto", () => {
    expect(leerNumeroEscrito("12,5")).toBe(12.5);
    expect(leerNumeroEscrito(" 12.5 ")).toBe(12.5);
  });

  it("vacío o con letras no es 0: es NaN, para decirlo", () => {
    expect(leerNumeroEscrito("")).toBeNaN();
    expect(leerNumeroEscrito("doce")).toBeNaN();
  });

  it("escribirNumero lo devuelve con coma", () => {
    expect(escribirNumero(12.5)).toBe("12,5");
    expect(escribirNumero(Number.NaN)).toBe("");
  });
});

describe("leerPedidoEscrito", () => {
  it("«12,5» con coma se queda en 12,5, no en 0", () => {
    const r = leerPedidoEscrito([linea({ cantidad: "12,5", precio_unitario: "3,20" })], "4,5");
    expect(r).toEqual({
      ok: true,
      envio: 4.5,
      lineas: [
        { descripcion: "DTF", cantidad: 12.5, precio_unitario: 3.2, iva_rate: 21, linea: "dtf" },
      ],
    });
  });

  it("la línea en blanco del todo se descarta sin más", () => {
    const r = leerPedidoEscrito(
      [linea(), linea({ descripcion: "", cantidad: "1", precio_unitario: "0" })],
      "",
    );
    expect(r.ok && r.lineas.length).toBe(1);
  });

  it("una línea con precio pero sin descripción se avisa, no se descarta", () => {
    const r = leerPedidoEscrito([linea(), linea({ descripcion: "" })], "");
    expect(r).toEqual({
      ok: false,
      errores: ["Línea 2: falta la descripción (escríbela o borra la línea)."],
    });
  });

  it("un número que no se lee se dice, con su línea", () => {
    const r = leerPedidoEscrito([linea({ cantidad: "doce" })], "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toContain("Línea 1: la cantidad «doce»");
  });

  it("cantidad 0 no se guarda en silencio", () => {
    const r = leerPedidoEscrito([linea({ cantidad: "0" })], "");
    expect(r.ok).toBe(false);
  });

  it("el envío mal escrito se dice", () => {
    const r = leerPedidoEscrito([linea()], "cinco");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toContain("Gastos de envío");
  });

  it("sin ninguna línea, lo pide", () => {
    const r = leerPedidoEscrito([linea({ descripcion: "", precio_unitario: "" })], "");
    expect(r).toEqual({ ok: false, errores: ["Añade al menos una línea."] });
  });
});

describe("lineaEnBlanco y lineasParaTotales", () => {
  it("la línea recién creada está en blanco; con descripción, no", () => {
    expect(lineaEnBlanco(linea({ descripcion: "", precio_unitario: "0" }))).toBe(true);
    expect(lineaEnBlanco(linea({ precio_unitario: "0" }))).toBe(false);
  });

  it("para los totales, lo que no se lee cuenta 0", () => {
    expect(lineasParaTotales([linea({ cantidad: "x" })])[0].cantidad).toBe(0);
  });
});
