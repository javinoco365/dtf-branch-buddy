import { describe, expect, it } from "vitest";
import { escribirNumero, leerNumeroEscrito, llevaPuntoDeMiles, numeroEnLetras } from "./numeros";

describe("leerNumeroEscrito", () => {
  it("coma o punto decimal", () => {
    expect(leerNumeroEscrito("12,5")).toBe(12.5);
    expect(leerNumeroEscrito("12.5")).toBe(12.5);
    expect(leerNumeroEscrito(" 7 ")).toBe(7);
    expect(leerNumeroEscrito("-3,25")).toBe(-3.25);
    expect(leerNumeroEscrito(4)).toBe(4);
  });

  it("punto seguido de exactamente tres cifras y sin coma: miles", () => {
    expect(leerNumeroEscrito("1.234")).toBe(1234);
    expect(leerNumeroEscrito("12.345.678")).toBe(12345678);
    // Con otro número de cifras, o empezando por 0, es decimal.
    expect(leerNumeroEscrito("1.23")).toBe(1.23);
    expect(leerNumeroEscrito("1.2345")).toBe(1.2345);
    expect(leerNumeroEscrito("0.250")).toBe(0.25);
  });

  it("con coma, los puntos son de miles", () => {
    expect(leerNumeroEscrito("1.234,5")).toBe(1234.5);
    expect(leerNumeroEscrito("1.234.567,89")).toBe(1234567.89);
  });

  it("vacío, letras o dos comas: NaN, nunca 0", () => {
    expect(leerNumeroEscrito("")).toBeNaN();
    expect(leerNumeroEscrito(null)).toBeNaN();
    expect(leerNumeroEscrito(undefined)).toBeNaN();
    expect(leerNumeroEscrito("doce")).toBeNaN();
    expect(leerNumeroEscrito("1,2,3")).toBeNaN();
    expect(leerNumeroEscrito("0x10")).toBeNaN();
    expect(leerNumeroEscrito("12 €")).toBeNaN();
  });
});

describe("escribirNumero", () => {
  it("con coma y sin ceros de más; vacío si no es un número", () => {
    expect(escribirNumero(12.5)).toBe("12,5");
    expect(escribirNumero(3)).toBe("3");
    expect(escribirNumero(Number.NaN)).toBe("");
  });
});

describe("llevaPuntoDeMiles", () => {
  it("«1.500» y «2.500,50» sí; «1.5», «0.250», «1500» y «12,5» no", () => {
    expect(llevaPuntoDeMiles("1.500")).toBe(true);
    expect(llevaPuntoDeMiles("2.500,50")).toBe(true);
    expect(["1.5", "0.250", "1500", "12,5", ""].some(llevaPuntoDeMiles)).toBe(false);
  });
});

describe("numeroEnLetras", () => {
  it("escribe en letra los enteros", () => {
    expect(numeroEnLetras(1500)).toBe("mil quinientos");
    expect(numeroEnLetras(2500)).toBe("dos mil quinientos");
    expect(numeroEnLetras(100)).toBe("cien");
    expect(numeroEnLetras(101)).toBe("ciento uno");
    expect(numeroEnLetras(21000)).toBe("veintiún mil");
    expect(numeroEnLetras(31000)).toBe("treinta y un mil");
    expect(numeroEnLetras(100000)).toBe("cien mil");
    expect(numeroEnLetras(1000000)).toBe("un millón");
    expect(numeroEnLetras(3750000)).toBe("tres millones setecientos cincuenta mil");
    expect(numeroEnLetras(0)).toBe("cero");
  });

  it("con decimales o negativo, null", () => {
    expect(numeroEnLetras(1.5)).toBeNull();
    expect(numeroEnLetras(-3)).toBeNull();
  });
});
