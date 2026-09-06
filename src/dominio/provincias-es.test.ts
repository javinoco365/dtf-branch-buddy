import { describe, expect, it } from "vitest";
import { nombreProvincia } from "./provincias-es";

describe("nombreProvincia", () => {
  it("traduce el código que manda WooCommerce", () => {
    // El caso que motiva el módulo: Woo guarda «H», no «Huelva».
    expect(nombreProvincia("H")).toBe("Huelva");
  });

  it("no confunde provincias con código parecido", () => {
    // H de Huelva y HU de Huesca son casos reales y distintos.
    expect(nombreProvincia("HU")).toBe("Huesca");
  });

  it("no distingue mayúsculas ni espacios sueltos", () => {
    expect(nombreProvincia("h")).toBe("Huelva");
    expect(nombreProvincia(" H ")).toBe("Huelva");
  });

  it("cubre las provincias con nombre en dos palabras y con tilde", () => {
    expect(nombreProvincia("PM")).toBe("Baleares");
    expect(nombreProvincia("GC")).toBe("Las Palmas");
    expect(nombreProvincia("TF")).toBe("Santa Cruz de Tenerife");
    expect(nombreProvincia("VI")).toBe("Araba/Álava");
    expect(nombreProvincia("A")).toBe("Alicante");
  });

  it("deja igual lo que ya viene como nombre completo", () => {
    // Un pedido manual trae el nombre escrito a mano, no un código.
    expect(nombreProvincia("Huelva")).toBe("Huelva");
    expect(nombreProvincia("Sevilla")).toBe("Sevilla");
  });

  it("deja igual lo que no reconoce, en vez de vaciarlo", () => {
    expect(nombreProvincia("Lisboa")).toBe("Lisboa");
    expect(nombreProvincia("")).toBe("");
  });
});
