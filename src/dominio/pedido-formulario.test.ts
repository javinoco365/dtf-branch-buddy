import { describe, expect, it } from "vitest";
import {
  avisosAntesDeGuardar,
  ivaDePedidoValido,
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

  it("un precio o un IVA vacíos no se guardan como 0: se dice en su línea", () => {
    const r = leerPedidoEscrito(
      [linea(), linea({ precio_unitario: "" }), linea({ iva_rate: " " })],
      "",
    );
    expect(r).toEqual({
      ok: false,
      errores: [
        "Línea 2: falta el precio (escribe 0 si va gratis).",
        "Línea 3: falta el IVA (escribe 0 si va sin IVA).",
      ],
    });
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

describe("IVA de las líneas", () => {
  it("solo 21, 10, 4 o 0", () => {
    expect([21, 10, 4, 0].every(ivaDePedidoValido)).toBe(true);
    expect([210, 7, 16, 2.1].some(ivaDePedidoValido)).toBe(false);
  });

  it("un IVA de 210 es un error en su línea", () => {
    const r = leerPedidoEscrito([linea(), linea({ iva_rate: "210" })], "");
    expect(r).toEqual({
      ok: false,
      errores: ["Línea 2: el IVA 210 % no existe: tiene que ser 21, 10, 4 o 0."],
    });
  });
});

describe("avisosAntesDeGuardar", () => {
  it("«1.500» m × «2.500» € pide confirmar las dos cifras y el importe", () => {
    const avisos = avisosAntesDeGuardar([linea({ cantidad: "1.500", precio_unitario: "2.500" })]);
    expect(avisos).toEqual([
      "Línea 1: en la cantidad has escrito 1.500: se guardará como mil quinientos. ¿Es correcto?",
      "Línea 1: en el precio has escrito 2.500: se guardará como dos mil quinientos. ¿Es correcto?",
      expect.stringMatching(
        /^Línea 1: 1500 × 2500,00\s€ = 3\.750\.000,00\s€ sin IVA\. ¿Es correcto\?$/,
      ),
    ]);
  });

  it("una línea normal no pide nada", () => {
    expect(avisosAntesDeGuardar([linea({ cantidad: "12,5", precio_unitario: "7" })])).toEqual([]);
  });

  it("una línea de más de 10.000 € sin puntos de miles también se confirma", () => {
    const avisos = avisosAntesDeGuardar([linea({ cantidad: "200", precio_unitario: "60" })]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/^Línea 1: 200 × /);
  });

  it("exactamente 10.000 € no se confirma; la línea en blanco tampoco", () => {
    expect(avisosAntesDeGuardar([linea({ cantidad: "100", precio_unitario: "100" })])).toEqual([]);
    expect(avisosAntesDeGuardar([{ ...linea(), descripcion: "", precio_unitario: "0" }])).toEqual(
      [],
    );
  });

  it("con decimales y miles dice la cifra en número", () => {
    const avisos = avisosAntesDeGuardar([linea({ cantidad: "1", precio_unitario: "1.234,5" })]);
    expect(avisos[0]).toBe(
      "Línea 1: en el precio has escrito 1.234,5: se guardará como 1234,5. ¿Es correcto?",
    );
  });
});
