import { describe, expect, it } from "vitest";
import {
  NOVEDADES,
  cuantasSinVer,
  guardarVistas,
  leerVistas,
  novedadesPorDia,
  ordenarNovedades,
  validarNovedad,
  type Novedad,
} from "./novedades";

const base: Novedad = {
  id: "2026-11-14-prueba",
  fecha: "2026-11-14",
  tipo: "nuevo",
  titulo: "Prueba",
  resumen: "Una frase corta.",
  puntos: ["Un punto."],
};

describe("las novedades publicadas", () => {
  it("todas pasan las reglas", () => {
    for (const n of NOVEDADES) expect([n.id, validarNovedad(n)]).toEqual([n.id, []]);
  });

  it("no repiten id", () => {
    const ids = NOVEDADES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("están escritas de más nueva a más antigua", () => {
    expect(ordenarNovedades(NOVEDADES).map((n) => n.id)).toEqual(NOVEDADES.map((n) => n.id));
  });
});

describe("validarNovedad", () => {
  it("acepta una entrada correcta", () => {
    expect(validarNovedad(base)).toEqual([]);
  });

  it("rechaza fechas malas y un id que no empieza por la fecha", () => {
    expect(validarNovedad({ ...base, fecha: "2026-13-40" })).toContain("fecha no válida");
    expect(validarNovedad({ ...base, id: "prueba" })).toContain("el id empieza por la fecha");
  });

  it("rechaza textos largos y demasiados puntos", () => {
    expect(validarNovedad({ ...base, titulo: "x".repeat(41) })).toContain("título largo");
    expect(validarNovedad({ ...base, resumen: "x".repeat(91) })).toContain("resumen largo");
    expect(validarNovedad({ ...base, puntos: ["a", "b", "c", "d"] })).toContain(
      "entre 1 y 3 puntos",
    );
    expect(validarNovedad({ ...base, puntos: [] })).toContain("entre 1 y 3 puntos");
  });

  it("rechaza palabras técnicas, sin confundirlas dentro de otras", () => {
    expect(validarNovedad({ ...base, resumen: "Nueva migración aplicada." })).toContain(
      "palabra técnica: «migración»",
    );
    expect(validarNovedad({ ...base, puntos: ["Arreglado el RLS."] })).toContain(
      "palabra técnica: «rls»",
    );
    // «prefijo» contiene «fij», no «fix»; «sqlite» no es una palabra suelta.
    expect(validarNovedad({ ...base, resumen: "Un prefijo nuevo." })).toEqual([]);
  });

  it("solo enlaza dentro del panel", () => {
    expect(
      validarNovedad({ ...base, enlace: { ruta: "https://ejemplo.com", texto: "Ir" } }),
    ).toContain("el enlace va a /panel");
  });
});

describe("orden y grupos", () => {
  const a = { ...base, id: "2026-11-10-a", fecha: "2026-11-10" };
  const b = { ...base, id: "2026-11-12-b", fecha: "2026-11-12" };
  const c = { ...base, id: "2026-11-12-c", fecha: "2026-11-12" };

  it("ordena por fecha y mantiene el orden escrito el mismo día", () => {
    expect(ordenarNovedades([a, b, c]).map((n) => n.id)).toEqual([b.id, c.id, a.id]);
  });

  it("agrupa por día", () => {
    expect(novedadesPorDia([a, b, c]).map((g) => [g.fecha, g.novedades.length])).toEqual([
      ["2026-11-12", 2],
      ["2026-11-10", 1],
    ]);
  });
});

describe("lo visto en este dispositivo", () => {
  const lista = [
    { ...base, id: "2026-11-14-a" },
    { ...base, id: "2026-11-14-b" },
  ];

  it("cuenta lo que no está visto", () => {
    expect(cuantasSinVer(lista, new Set())).toBe(2);
    expect(cuantasSinVer(lista, new Set(["2026-11-14-a"]))).toBe(1);
  });

  it("lee lo guardado sin romperse con basura", () => {
    expect(leerVistas(null).size).toBe(0);
    expect(leerVistas("no es json").size).toBe(0);
    expect(leerVistas('{"a":1}').size).toBe(0);
    expect([...leerVistas('["x", 3, "y"]')]).toEqual(["x", "y"]);
  });

  it("guarda solo los ids que existen", () => {
    expect(leerVistas(guardarVistas(lista))).toEqual(new Set(["2026-11-14-a", "2026-11-14-b"]));
  });
});
