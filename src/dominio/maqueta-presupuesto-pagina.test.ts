import { describe, expect, it } from "vitest";
import {
  MM_POR_PUNTO,
  ajusteVertical,
  anchoDisponible,
  anclaEnPagina,
  bajada,
  inicioTexto,
  maquetaDatos,
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
    // El título de siempre (derecha, en 194) pasado «a la izquierda»: acaba en 194.
    expect(anclaEnPagina(194, "izquierda", 62)).toBe(132);
    // El nombre o el texto libre (izquierda, en 16) pasados a la derecha o al centro: empiezan en 16.
    expect(anclaEnPagina(16, "derecha", 100)).toBe(116);
    expect(anclaEnPagina(16, "centro", 100)).toBe(66);
    expect(anclaEnPagina(194, "centro", 100)).toBe(144);
  });

  it("fuera del papel, también vuelve dentro", () => {
    expect(anclaEnPagina(210, "izquierda", 30)).toBe(164);
    expect(anclaEnPagina(0, "derecha", 30)).toBe(46);
    expect(anclaEnPagina(205, "centro", 30)).toBe(179);
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

describe("maquetaDatos", () => {
  // Anchos medidos con jsPDF: etiqueta en normal 8,5 pt y valor en negrita 9,5 pt.
  const numero = { etiqueta: 10.59, valor: 36.03 }; // «Número», «PRES-DTFC-2026-0001»
  const fecha = { etiqueta: 8.28, valor: 16.62 }; // «Fecha», «16/10/2026»
  const validez = { etiqueta: 16.37, valor: 16.62 }; // «Válido hasta», «15/11/2026»
  const lasTres = [numero, fecha, validez];
  const sinPisarse = (
    m: ReturnType<typeof maquetaDatos>,
    filas: { etiqueta: number; valor: number }[],
    ancho: number,
  ) =>
    m.filas.forEach((f, i) => {
      const e = filas[i].etiqueta * f.escalaEtiqueta;
      const v = filas[i].valor * f.escalaValor;
      if (f.yValor === f.y) expect(e + 3 + v).toBeLessThanOrEqual(ancho + 1e-9);
      else {
        expect(e).toBeLessThanOrEqual(ancho + 1e-9);
        expect(v).toBeLessThanOrEqual(ancho + 1e-9);
      }
    });

  it("con lo de siempre (66 mm) no cambia nada: una fila cada 5,5 mm, a tamaño completo", () => {
    const m = maquetaDatos(lasTres, 66);
    expect(m.escala).toBe(1);
    expect(m.filas.map((f) => [f.y, f.yValor, f.escalaEtiqueta, f.escalaValor])).toEqual([
      [0, 0, 1, 1],
      [5.5, 5.5, 1, 1],
      [11, 11, 1, 1],
    ]);
    expect(m.alto).toBe(11);
  });

  it("un prefijo de ocho letras también cabe a tamaño completo en 66 mm", () => {
    expect(maquetaDatos([{ etiqueta: 10.59, valor: 46.05 }, fecha, validez], 66).escala).toBe(1);
  });

  it("estrecho (40 mm): todo el bloque encoge por igual y nada se pisa", () => {
    const m = maquetaDatos(lasTres, 40);
    expect(m.escala).toBeLessThan(1);
    expect(m.escala).toBeGreaterThanOrEqual(0.75);
    expect(m.filas.every((f) => f.escalaEtiqueta === m.escala && f.y === f.yValor)).toBe(true);
    expect(m.filas.map((f) => f.y)).toEqual([0, 5.5, 11]);
    sinPisarse(m, lasTres, 40);
  });

  it("una etiqueta larga en 66 mm encoge el bloque, sin partir nada", () => {
    const filas = [{ etiqueta: 42.37, valor: 36.03 }, fecha, validez];
    const m = maquetaDatos(filas, 66);
    expect(m.escala).toBeCloseTo((66 - 3) / (42.37 + 36.03));
    expect(m.alto).toBe(11);
    sinPisarse(m, filas, 66);
  });

  it("en 30 mm el número va debajo de su etiqueta y las filas de después bajan", () => {
    const m = maquetaDatos(lasTres, 30);
    expect(m.filas[0].yValor).toBeGreaterThan(m.filas[0].y);
    expect(m.filas[1].y).toBeCloseTo(m.filas[0].yValor + 5.5);
    expect(m.filas[1].yValor).toBe(m.filas[1].y);
    expect(m.filas[2].yValor).toBe(m.filas[2].y);
    expect(m.alto).toBeGreaterThan(11);
    sinPisarse(m, lasTres, 30);
  });

  it("si no cabe ninguna fila, todas se parten a la escala mínima", () => {
    const filas = [
      { etiqueta: 42.37, valor: 36.03 },
      { etiqueta: 44, valor: 16.62 },
      { etiqueta: 40, valor: 16.62 },
    ];
    const m = maquetaDatos(filas, 30);
    expect(m.escala).toBe(0.75);
    expect(m.filas.every((f) => f.yValor > f.y)).toBe(true);
    sinPisarse(m, filas, 30);
  });

  it("sin filas, nada", () => {
    expect(maquetaDatos([], 66)).toEqual({ escala: 1, filas: [], alto: 0 });
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
