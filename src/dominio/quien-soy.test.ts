import { describe, expect, it } from "vitest";
import { estadoQuienSoy, iniciales, type PersonaCuenta } from "./quien-soy";

const JN: PersonaCuenta = { id: "jn", nombre: "Javier Novoa" };
const MN: PersonaCuenta = { id: "mn", nombre: "Miguel Novoa" };
const AR: PersonaCuenta = { id: "ar", nombre: "Álvaro Romero" };
const JC: PersonaCuenta = { id: "jc", nombre: "Javier Cárdenas" };
const GERENCIA = [JN, MN, AR];

describe("estadoQuienSoy", () => {
  it("sin socios en la cuenta, no pregunta nada", () => {
    expect(estadoQuienSoy([], null)).toEqual({ tipo: "sin-personas" });
  });

  it("con un solo socio, entra identificado y no puede cambiar", () => {
    expect(estadoQuienSoy([JC], null)).toEqual({
      tipo: "identificado",
      persona: JC,
      personas: [JC],
      puedeCambiar: false,
    });
  });

  it("con un solo socio da igual lo que tenga guardado el dispositivo", () => {
    expect(estadoQuienSoy([JC], "mn")).toMatchObject({ tipo: "identificado", persona: JC });
  });

  it("con varios, un dispositivo que no ha elegido nunca pregunta", () => {
    expect(estadoQuienSoy(GERENCIA, null)).toEqual({ tipo: "elegir", personas: GERENCIA });
  });

  it("con varios, el dispositivo que ya eligió entra directo con esa persona", () => {
    expect(estadoQuienSoy(GERENCIA, "mn")).toMatchObject({
      tipo: "identificado",
      persona: MN,
      puedeCambiar: true,
    });
  });

  it("si la persona guardada no es de esta cuenta, pregunta", () => {
    expect(estadoQuienSoy(GERENCIA, "jc").tipo).toBe("elegir");
  });
});

describe("iniciales", () => {
  it("dos palabras, dos letras", () => {
    expect(iniciales("Javier Novoa")).toBe("JN");
    expect(iniciales("Álvaro Romero")).toBe("ÁR");
  });
  it("una palabra, una letra; espacios de más, igual", () => {
    expect(iniciales("  Álvaro ")).toBe("Á");
    expect(iniciales("Javi  N")).toBe("JN");
  });
});
