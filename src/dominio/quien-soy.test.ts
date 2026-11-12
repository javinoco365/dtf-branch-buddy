import { describe, expect, it } from "vitest";
import {
  estadoQuienSoy,
  iniciales,
  leerEleccion,
  ordenarConUltima,
  type PersonaCuenta,
} from "./quien-soy";

const JN: PersonaCuenta = { id: "jn", nombre: "Javier Novoa" };
const MN: PersonaCuenta = { id: "mn", nombre: "Miguel Novoa" };
const AR: PersonaCuenta = { id: "ar", nombre: "Álvaro Romero" };
const JC: PersonaCuenta = { id: "jc", nombre: "Javier Cárdenas" };
const GERENCIA = [JN, MN, AR];

describe("estadoQuienSoy", () => {
  it("sin socios en la cuenta, no pregunta nada", () => {
    expect(estadoQuienSoy([], null, "s1", null)).toEqual({ tipo: "sin-personas" });
  });

  it("con un solo socio, entra identificado y no puede cambiar", () => {
    expect(estadoQuienSoy([JC], null, "s1", null)).toEqual({
      tipo: "identificado",
      persona: JC,
      personas: [JC],
      puedeCambiar: false,
    });
  });

  it("con varios y sin elegir, pregunta", () => {
    const e = estadoQuienSoy(GERENCIA, null, "s1", null);
    expect(e.tipo).toBe("elegir");
  });

  it("la elección de esta sesión vale", () => {
    const e = estadoQuienSoy(GERENCIA, { socioId: "mn", sesion: "s1" }, "s1", "mn");
    expect(e).toMatchObject({ tipo: "identificado", persona: MN, puedeCambiar: true });
  });

  it("la elección de otro inicio de sesión ya no vale: vuelve a preguntar", () => {
    const e = estadoQuienSoy(GERENCIA, { socioId: "mn", sesion: "s0" }, "s1", "mn");
    expect(e.tipo).toBe("elegir");
  });

  it("sin saber la sesión, no da por buena ninguna elección", () => {
    const e = estadoQuienSoy(GERENCIA, { socioId: "mn", sesion: "s1" }, null, "mn");
    expect(e.tipo).toBe("elegir");
  });

  it("si el socio elegido ya no está en la cuenta, vuelve a preguntar", () => {
    const e = estadoQuienSoy([JN, AR], { socioId: "mn", sesion: "s1" }, "s1", "mn");
    expect(e).toMatchObject({ tipo: "elegir", ultimaId: null });
  });

  it("al preguntar, la última persona del dispositivo sale la primera", () => {
    const e = estadoQuienSoy(GERENCIA, null, "s1", "ar");
    expect(e).toEqual({ tipo: "elegir", personas: [AR, JN, MN], ultimaId: "ar" });
  });
});

describe("ordenarConUltima", () => {
  it("sin última, el orden de siempre", () => {
    expect(ordenarConUltima(GERENCIA, null)).toEqual(GERENCIA);
  });
  it("una última que no está en la lista no cambia nada", () => {
    expect(ordenarConUltima(GERENCIA, "jc")).toEqual(GERENCIA);
  });
  it("no toca la lista original", () => {
    const lista = [...GERENCIA];
    ordenarConUltima(lista, "mn");
    expect(lista).toEqual(GERENCIA);
  });
});

describe("leerEleccion", () => {
  it("lee lo que se guardó", () => {
    expect(leerEleccion('{"socioId":"jn","sesion":"s1"}')).toEqual({ socioId: "jn", sesion: "s1" });
  });
  it("nada, roto o con otra forma: null", () => {
    expect(leerEleccion(null)).toBeNull();
    expect(leerEleccion("")).toBeNull();
    expect(leerEleccion("{no es json")).toBeNull();
    expect(leerEleccion('{"socioId":1,"sesion":"s1"}')).toBeNull();
    expect(leerEleccion('"jn"')).toBeNull();
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
