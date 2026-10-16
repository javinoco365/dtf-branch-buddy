import { describe, expect, it } from "vitest";
import {
  BLANCO,
  CIELO,
  MARINO,
  TINTA,
  alineacionDeCaja,
  altoLinea,
  anchoDisponible,
  anchosColumnas,
  cajaTexto,
  colorHex,
  coloresDocumento,
  contraste,
  encajarImagen,
  encajarTexto,
  inicioCuerpo,
  inicioTexto,
  juntarConAceptacion,
  maquetaPie,
  type Medir,
  type Partir,
} from "./maqueta-presupuesto";

// Una fuente de mentira: cada carácter mide medio punto en mm.
const medir: Medir = (texto, tamano) => texto.length * tamano * 0.5 * (25.4 / 72);
const partir: Partir = (texto, ancho, tamano) => {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && medir(prueba, tamano) > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  return actual ? [...lineas, actual] : lineas;
};

describe("inicioTexto y cajaTexto", () => {
  it("coloca el texto según su alineación", () => {
    expect(inicioTexto(100, 40, "izquierda")).toBe(100);
    expect(inicioTexto(100, 40, "centro")).toBe(80);
    expect(inicioTexto(100, 40, "derecha")).toBe(60);
  });

  it("la caja baja con cada línea de más", () => {
    const una = cajaTexto(16, 24, 50, 1, 18, "izquierda");
    const dos = cajaTexto(16, 24, 50, 2, 18, "izquierda");
    expect(una.x0).toBe(16);
    expect(una.x1).toBe(66);
    expect(una.y0).toBeLessThan(24);
    expect(dos.y1 - una.y1).toBeCloseTo(altoLinea(18));
  });
});

describe("anchoDisponible", () => {
  const titulo = { x0: 135, y0: 17, x1: 194, y1: 25 };
  const datos = { x0: 128, y0: 28.6, x1: 194, y1: 42.7 };

  it("sin nada al lado, hasta el margen de la página", () => {
    expect(anchoDisponible({ x: 16, alineacion: "izquierda" }, { y0: 18, y1: 30 }, [])).toBe(178);
    expect(anchoDisponible({ x: 194, alineacion: "derecha" }, { y0: 18, y1: 30 }, [])).toBe(178);
    expect(anchoDisponible({ x: 105, alineacion: "centro" }, { y0: 18, y1: 30 }, [])).toBe(178);
  });

  it("se para antes de lo que hay a su altura, con un hueco", () => {
    // El nombre de la tienda a la izquierda, con los datos del presupuesto a la derecha.
    expect(
      anchoDisponible({ x: 16, alineacion: "izquierda" }, { y0: 19, y1: 33 }, [titulo, datos]),
    ).toBe(128 - 6 - 16);
  });

  it("lo que está a otra altura no estorba", () => {
    expect(anchoDisponible({ x: 16, alineacion: "izquierda" }, { y0: 50, y1: 60 }, [datos])).toBe(
      178,
    );
  });

  it("lo que está detrás del ancla no estorba", () => {
    const logo = { x0: 16, y0: 14, x1: 68, y1: 36 };
    expect(anchoDisponible({ x: 16, alineacion: "izquierda" }, { y0: 18, y1: 30 }, [logo])).toBe(
      178,
    );
  });

  it("centrado, el lado más estrecho manda en los dos", () => {
    const izquierda = { x0: 16, y0: 18, x1: 60, y1: 30 };
    expect(anchoDisponible({ x: 105, alineacion: "centro" }, { y0: 18, y1: 30 }, [izquierda])).toBe(
      2 * (105 - 66),
    );
  });

  it("nunca menos del mínimo", () => {
    const pegado = { x0: 20, y0: 18, x1: 60, y1: 30 };
    expect(anchoDisponible({ x: 16, alineacion: "izquierda" }, { y0: 18, y1: 30 }, [pegado])).toBe(
      15,
    );
  });
});

describe("encajarImagen", () => {
  it("encaja sin deformar, pegada arriba y a la izquierda en la caja de siempre", () => {
    const c = encajarImagen({ x: 16, y: 14, ancho: 52, alto: 22 }, { ancho: 600, alto: 220 });
    expect(c.x0).toBe(16);
    expect(c.y0).toBe(14);
    expect(c.x1 - c.x0).toBeCloseTo(52);
    expect(c.y1 - c.y0).toBeCloseTo(52 * (220 / 600));
  });

  it("centrada si la caja está en el centro de la página, a la derecha si está a la derecha", () => {
    const centrada = encajarImagen({ x: 55, y: 10, ancho: 100, alto: 30 }, { ancho: 1, alto: 1 });
    expect(centrada.x0).toBeCloseTo(90);
    expect(centrada.x1).toBeCloseTo(120);
    const derecha = encajarImagen({ x: 150, y: 10, ancho: 44, alto: 24 }, { ancho: 1, alto: 1 });
    expect(derecha.x1).toBeCloseTo(194);
  });

  it("una imagen sin medidas no ocupa nada", () => {
    const c = encajarImagen({ x: 16, y: 14, ancho: 52, alto: 22 }, { ancho: 0, alto: 0 });
    expect(c.x1 - c.x0).toBe(0);
  });

  it("alineacionDeCaja", () => {
    expect(alineacionDeCaja(16, 52)).toBe("izquierda");
    expect(alineacionDeCaja(80, 50)).toBe("centro");
    expect(alineacionDeCaja(150, 44)).toBe("derecha");
  });
});

describe("encajarTexto", () => {
  const opciones = { tamano: 18, minimoUnaLinea: 12, minimo: 6, maxLineas: 2 };

  it("si cabe, tal cual", () => {
    expect(encajarTexto("DTF Culture", 100, opciones, medir, partir)).toEqual({
      tamano: 18,
      lineas: ["DTF Culture"],
    });
  });

  it("si no cabe, primero más pequeño en una línea", () => {
    const texto = "Camisetas Personalizadas Huelva"; // 31 caracteres: 98,4 mm a 18 pt
    const r = encajarTexto(texto, 90, opciones, medir, partir);
    expect(r.lineas).toEqual([texto]);
    expect(r.tamano).toBeLessThan(18);
    expect(r.tamano).toBeGreaterThanOrEqual(12);
    expect(medir(texto, r.tamano)).toBeLessThanOrEqual(90);
  });

  it("si en una línea quedaría demasiado pequeño, en dos, y nunca se corta", () => {
    const texto = "Impresiones Textiles y Transfer DTF de Andalucía Occidental";
    const r = encajarTexto(texto, 90, opciones, medir, partir);
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas.join(" ")).toBe(texto);
    expect(r.lineas.every((l) => medir(l, r.tamano) <= 90)).toBe(true);
  });

  it("si ni así cabe, al mínimo con todas las líneas que hagan falta", () => {
    const texto = Array.from({ length: 30 }, () => "palabra").join(" ");
    const r = encajarTexto(texto, 30, opciones, medir, partir);
    expect(r.tamano).toBe(6);
    expect(r.lineas.length).toBeGreaterThan(2);
    expect(r.lineas.join(" ")).toBe(texto);
  });

  it("un texto vacío no ocupa líneas", () => {
    expect(encajarTexto("  ", 90, opciones, medir, partir).lineas).toEqual([]);
  });
});

describe("maquetaPie", () => {
  it("con el pie de siempre, lo de antes: raya a 282 y el cuerpo hasta 273", () => {
    for (const lineas of [0, 1, 2]) {
      const p = maquetaPie(lineas, 7);
      expect(p.raya).toBe(282);
      expect(p.primeraLinea).toBe(286.5);
      expect(p.finCuerpo).toBe(273);
      expect(p.finTabla).toBe(269);
    }
  });

  it("tres líneas grandes suben el pie y la última no baja de 7,5 mm del borde", () => {
    const p = maquetaPie(3, 12);
    expect(p.primeraLinea + 2 * altoLinea(12)).toBeCloseTo(297 - 7.5);
    expect(p.raya).toBeLessThan(p.primeraLinea - 3);
    expect(p.finCuerpo).toBe(p.raya - 9);
  });
});

describe("inicioCuerpo", () => {
  it("debajo de la raya de la cabecera", () => {
    expect(inicioCuerpo(48, [{ x0: 0, y0: 0, x1: 1, y1: 42.7 }])).toBe(55);
  });
  it("nunca por encima de lo más bajo de la cabecera", () => {
    expect(inicioCuerpo(48, [{ x0: 0, y0: 0, x1: 1, y1: 60 }])).toBe(66);
  });
});

describe("anchosColumnas", () => {
  it("los anchos de siempre si el contenido cabe", () => {
    expect(anchosColumnas({ cantidad: 15, precio: 20, iva: 12, importe: 20 }, 178)).toEqual({
      descripcion: 178 - 25 - 28 - 16 - 28,
      cantidad: 25,
      precio: 28,
      iva: 16,
      importe: 28,
    });
  });

  it("una columna crece hasta su tope y la descripción se queda el resto", () => {
    const a = anchosColumnas({ cantidad: 15, precio: 35, iva: 12, importe: 50 }, 178);
    expect(a.precio).toBe(35);
    expect(a.importe).toBe(36);
    expect(a.descripcion).toBe(178 - 25 - 35 - 16 - 36);
  });

  it("las columnas ocultas no ocupan sitio", () => {
    const a = anchosColumnas({ importe: 20 }, 178);
    expect(a).toEqual({ descripcion: 150, importe: 28 });
  });

  it("la descripción nunca baja del mínimo: lo que crece se reparte", () => {
    const a = anchosColumnas({ cantidad: 99, precio: 99, iva: 99, importe: 99 }, 178, 70);
    expect(a.descripcion).toBeCloseTo(70);
    expect(a.cantidad! + a.precio! + a.iva! + a.importe!).toBeCloseTo(108);
    expect(a.precio).toBeGreaterThan(28);
  });
});

describe("colores", () => {
  it("colorHex lee las dos formas y rechaza lo demás", () => {
    expect(colorHex("#2a2260")).toEqual([42, 34, 96]);
    expect(colorHex("22a")).toEqual([34, 34, 170]);
    expect(colorHex("azul")).toBeNull();
    expect(colorHex(null)).toBeNull();
  });

  it("contraste: blanco sobre negro, 21", () => {
    expect(contraste([0, 0, 0], BLANCO)).toBeCloseTo(21);
    expect(contraste(BLANCO, BLANCO)).toBeCloseTo(1);
  });

  it("sin plantilla: el color de la tienda si se lee el blanco encima; si no, el de la casa", () => {
    expect(coloresDocumento({ base: "#2a2260" })).toMatchObject({
      principal: [42, 34, 96],
      acento: [42, 34, 96],
      sobrePrincipal: BLANCO,
    });
    expect(coloresDocumento({ base: "#FCD34D" })).toMatchObject({
      principal: MARINO,
      acento: CIELO,
    });
    expect(coloresDocumento({})).toMatchObject({ principal: MARINO, acento: CIELO });
  });

  it("el de la plantilla manda, aunque sea claro: lo de encima pasa a tinta oscura", () => {
    const c = coloresDocumento({ principal: "#fcd34d", base: "#2a2260" });
    expect(c.principal).toEqual([252, 211, 77]);
    expect(c.acento).toEqual([252, 211, 77]);
    expect(c.sobrePrincipal).toEqual(TINTA);
    expect(c.textoPrincipal).toEqual(TINTA);
  });

  it("el acento de la plantilla, aparte", () => {
    const c = coloresDocumento({ acento: "#f59e0b" });
    expect(c.principal).toEqual(MARINO);
    expect(c.acento).toEqual([245, 158, 11]);
  });
});

describe("juntarConAceptacion", () => {
  it("unas condiciones cortas pasan de página con la caja de firma", () => {
    expect(juntarConAceptacion(23, 26, 247)).toBe(true);
  });
  it("un bloque largo no: pasa línea a línea", () => {
    expect(juntarConAceptacion(150, 26, 247)).toBe(false);
  });
  it("sin nada delante, nada que juntar", () => {
    expect(juntarConAceptacion(0, 26, 247)).toBe(false);
  });
});
