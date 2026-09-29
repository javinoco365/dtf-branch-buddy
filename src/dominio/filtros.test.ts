import { describe, expect, it } from "vitest";
import {
  escribirFecha,
  escribirFiltros,
  hayFiltros,
  leerFecha,
  leerFiltros,
  quitarFiltros,
  rangoPeriodo,
} from "./filtros";

const porDefecto = { q: "", estado: "todos", parciales: false, pagina: 1 };

describe("leerFiltros", () => {
  it("sin nada en la dirección, los valores por defecto", () => {
    expect(leerFiltros({}, porDefecto)).toEqual(porDefecto);
    expect(leerFiltros(undefined, porDefecto)).toEqual(porDefecto);
  });

  it("convierte al tipo del valor por defecto, venga como venga", () => {
    expect(
      leerFiltros({ q: 123, estado: "cobrado", parciales: "true", pagina: "3" }, porDefecto),
    ).toEqual({
      q: "123",
      estado: "cobrado",
      parciales: true,
      pagina: 3,
    });
    expect(leerFiltros({ parciales: true }, porDefecto).parciales).toBe(true);
  });

  it("lo que no se entiende vale lo por defecto", () => {
    expect(leerFiltros({ parciales: "quizas", pagina: "x" }, porDefecto)).toEqual(porDefecto);
  });

  it("ignora lo que no es de estos filtros", () => {
    expect(leerFiltros({ otra: "cosa" }, porDefecto)).toEqual(porDefecto);
  });
});

describe("escribirFiltros", () => {
  it("solo guarda lo que difiere del valor por defecto", () => {
    expect(escribirFiltros({}, { q: "peña", estado: "todos" }, porDefecto)).toEqual({ q: "peña" });
  });

  it("volver al valor por defecto quita la clave", () => {
    expect(
      escribirFiltros({ q: "peña", estado: "cobrado" }, { estado: "todos" }, porDefecto),
    ).toEqual({
      q: "peña",
    });
  });

  it("respeta las claves de otros filtros, y no escribe las ajenas", () => {
    expect(
      escribirFiltros({ pestana: "facturas" }, { q: "x", otra: "no" } as never, porDefecto),
    ).toEqual({
      pestana: "facturas",
      q: "x",
    });
  });
});

describe("quitarFiltros y hayFiltros", () => {
  it("quita solo estos filtros", () => {
    expect(quitarFiltros({ q: "x", pestana: "facturas" }, porDefecto)).toEqual({
      pestana: "facturas",
    });
  });

  it("dice si hay alguno puesto, ignorando los que se pidan", () => {
    expect(hayFiltros(porDefecto, porDefecto)).toBe(false);
    expect(hayFiltros({ ...porDefecto, q: "x" }, porDefecto)).toBe(true);
    expect(hayFiltros({ ...porDefecto, pagina: 2 }, porDefecto, ["pagina"])).toBe(false);
  });
});

describe("fechas de referencia", () => {
  const hoy = new Date(2026, 8, 29, 10);

  it("lee yyyy-MM-dd; vacío o mal escrito es hoy", () => {
    expect(leerFecha("2026-03-15", hoy)).toEqual(new Date(2026, 2, 15));
    expect(leerFecha("", hoy)).toBe(hoy);
    expect(leerFecha("2026-02-31", hoy)).toBe(hoy);
    expect(leerFecha("ayer", hoy)).toBe(hoy);
  });

  it("no escribe la fecha si cae en el periodo actual", () => {
    expect(escribirFecha(new Date(2026, 8, 3), "mes", hoy)).toBe("");
    expect(escribirFecha(new Date(2026, 7, 3), "mes", hoy)).toBe("2026-08-03");
    expect(escribirFecha(new Date(2026, 8, 30), "semana", hoy)).toBe("");
    expect(escribirFecha(new Date(2026, 8, 22), "semana", hoy)).toBe("2026-09-22");
  });

  it("mes natural y semana de lunes a domingo", () => {
    expect(rangoPeriodo(hoy, "mes").desde).toEqual(new Date(2026, 8, 1));
    const s = rangoPeriodo(hoy, "semana");
    expect(s.desde).toEqual(new Date(2026, 8, 28));
    expect(s.hasta.getDate()).toBe(4);
  });
});
