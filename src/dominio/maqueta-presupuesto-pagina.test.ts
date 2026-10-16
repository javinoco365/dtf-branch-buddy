import { describe, expect, it } from "vitest";
import {
  MM_POR_PUNTO,
  ajusteVertical,
  anchoDisponible,
  anclaEnPagina,
  bajada,
  inicioTexto,
  referenciaPaginas,
  tramoEnPagina,
} from "./maqueta-presupuesto";
import { ALTO_PAGINA, ANCHO_PAGINA, MARGEN, PLANTILLA_POR_DEFECTO } from "./plantilla-presupuesto";

// Que nada se salga del papel ni se pise, sea cual sea la plantilla.

describe("anclaEnPagina", () => {
  it("con sitio hasta el margen, el ancla no se toca", () => {
    expect(anclaEnPagina(194, "derecha", 62)).toBe(194);
    expect(anclaEnPagina(16, "izquierda", 100)).toBe(16);
    expect(anclaEnPagina(105, "centro", 80)).toBe(105);
    // 19 mm hasta el margen: el texto se encoge ahí, como siempre.
    expect(anclaEnPagina(175, "izquierda", 62)).toBe(175);
  });

  it("pegado al margen hacia el que crece, se mete lo justo para caber a su tamaño", () => {
    // Un título a la derecha en 194 pasado «a la izquierda»: acaba en el margen, en 196.
    expect(anclaEnPagina(194, "izquierda", 62)).toBe(134);
    // El nombre (izquierda, en 16) pasado a la derecha o al centro: empieza en el margen, en 14.
    expect(anclaEnPagina(16, "derecha", 100)).toBe(114);
    expect(anclaEnPagina(16, "centro", 100)).toBe(64);
    expect(anclaEnPagina(194, "centro", 100)).toBe(146);
  });

  it("fuera del papel, también vuelve dentro", () => {
    expect(anclaEnPagina(210, "izquierda", 30)).toBe(166);
    expect(anclaEnPagina(0, "derecha", 30)).toBe(44);
    expect(anclaEnPagina(205, "centro", 30)).toBe(181);
  });

  it("nunca pide más que el ancho entre márgenes", () => {
    expect(anclaEnPagina(194, "izquierda", 300)).toBe(MARGEN);
    expect(anclaEnPagina(16, "derecha", 300)).toBe(ANCHO_PAGINA - MARGEN);
    expect(anclaEnPagina(16, "centro", 300)).toBe(ANCHO_PAGINA / 2);
  });

  it("un texto que ya cabe no se aleja del borde", () => {
    expect(anclaEnPagina(190, "izquierda", 2)).toBe(190);
  });

  it("con el ancla corregida, el texto a su tamaño queda entre los márgenes", () => {
    const casos = [
      [194, "izquierda", 62],
      [16, "derecha", 100],
      [16, "centro", 100],
      [210, "izquierda", 30],
      [0, "centro", 50],
    ] as const;
    for (const [x0, alineacion, natural] of casos) {
      const x = anclaEnPagina(x0, alineacion, natural);
      const ancho = anchoDisponible({ x, alineacion }, { y0: 18, y1: 30 }, []);
      expect(ancho).toBeGreaterThanOrEqual(natural);
      const inicio = inicioTexto(x, natural, alineacion);
      expect(inicio).toBeGreaterThanOrEqual(MARGEN - 1e-9);
      expect(inicio + natural).toBeLessThanOrEqual(ANCHO_PAGINA - MARGEN + 1e-9);
    }
  });
});

describe("tramoEnPagina", () => {
  it("dentro del papel, sale tal cual", () => {
    expect(tramoEnPagina(16, 52)).toEqual({ inicio: 16, largo: 52 });
    expect(tramoEnPagina(14, 22, ALTO_PAGINA)).toEqual({ inicio: 14, largo: 22 });
  });

  it("si se sale, se desplaza hacia dentro sin cambiar de tamaño", () => {
    // El logo en X = 170 con el ancho de siempre, y en X = 150 con 180 de ancho.
    expect(tramoEnPagina(170, 52)).toEqual({ inicio: 158, largo: 52 });
    expect(tramoEnPagina(150, 180)).toEqual({ inicio: 30, largo: 180 });
    // Los datos en X = 150 con su ancho de siempre.
    expect(tramoEnPagina(150, 66)).toEqual({ inicio: 144, largo: 66 });
    expect(tramoEnPagina(-5, 20)).toEqual({ inicio: 0, largo: 20 });
    expect(tramoEnPagina(297, 22, ALTO_PAGINA)).toEqual({ inicio: 275, largo: 22 });
  });

  it("si ni así cabe, se queda en el total", () => {
    expect(tramoEnPagina(10, 300, ALTO_PAGINA)).toEqual({ inicio: 0, largo: ALTO_PAGINA });
  });
});

describe("ajusteVertical", () => {
  it("dentro del papel, nada", () => {
    expect(ajusteVertical(23, 0, 24)).toBe(0);
    expect(ajusteVertical(31, 11, 9.5)).toBe(0);
  });

  it("pegado arriba, baja hasta que las tildes de las mayúsculas caben", () => {
    const dy = ajusteVertical(0, 0, 24);
    expect(dy).toBeGreaterThan(0);
    expect(0 + dy - 24 * MM_POR_PUNTO * 0.93).toBeCloseTo(0);
  });

  it("pegado abajo, sube hasta que la última línea cabe", () => {
    const dy = ajusteVertical(297, 2 * 7, 18);
    expect(dy).toBeLessThan(0);
    expect(297 + dy + 14 + bajada(18)).toBeCloseTo(ALTO_PAGINA);
  });
});

describe("referenciaPaginas", () => {
  it("el título de por defecto sale como siempre", () => {
    expect(
      referenciaPaginas(PLANTILLA_POR_DEFECTO.cabecera.titulo.texto, "PRES-DTFC-2026-0001"),
    ).toBe("Presupuesto PRES-DTFC-2026-0001");
    expect(referenciaPaginas("", "PRES-DTFC-2026-0001")).toBe("Presupuesto PRES-DTFC-2026-0001");
  });

  it("un título propio, tal como se escribió: las siglas no pasan a minúsculas", () => {
    expect(referenciaPaginas("PRESUPUESTO DTF", "PRES-DTFC-2026-0001")).toBe(
      "PRESUPUESTO DTF PRES-DTFC-2026-0001",
    );
    expect(referenciaPaginas("OFERTA", "PRES-TEX-2026-0007")).toBe("OFERTA PRES-TEX-2026-0007");
    expect(referenciaPaginas("Presupuesto DTF", "")).toBe("Presupuesto DTF");
  });

  it("sin espacios de más", () => {
    expect(referenciaPaginas("  Oferta   textil ", " PRES-1 ")).toBe("Oferta textil PRES-1");
  });
});
