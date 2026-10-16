import { describe, expect, it } from "vitest";
import {
  ENCAJE_TITULO,
  cajaDatos,
  encajarEnCabecera,
  encajeNombre,
  limitesEnPapel,
  maquetarCabecera,
  partirTextoLibre,
  type MedidasTexto,
} from "./maqueta-cabecera";
import {
  altoLinea,
  bajada,
  encajarImagen,
  subida,
  type Medir,
  type Partir,
} from "./maqueta-presupuesto";
import { PLANTILLA_POR_DEFECTO, type PlantillaPresupuesto } from "./plantilla-presupuesto";

// Una fuente de mentira: cada carácter mide medio punto en mm (la negrita, igual).
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
const medidas: MedidasTexto = { medir: () => medir, partir: () => partir };

type Cabecera = PlantillaPresupuesto["cabecera"];
const cabecera = (cambios: (c: Cabecera) => void = () => {}): Cabecera => {
  const c = structuredClone(PLANTILLA_POR_DEFECTO.cabecera);
  cambios(c);
  return c;
};
const contenido = {
  logo: { ancho: 300, alto: 100 },
  filasDatos: 3,
  parrafos: [] as string[],
  nombre: "Tienda Uno",
};

describe("maquetarCabecera", () => {
  it("con la plantilla de siempre y logo: logo, datos y título; el nombre no sale", () => {
    const m = maquetarCabecera(cabecera(), contenido, medidas);
    // El logo, encajado en su caja de 52 × 22 sin deformarse: 52 × 17,3.
    expect(m.logo).toEqual(encajarImagen(PLANTILLA_POR_DEFECTO.cabecera.logo, contenido.logo));
    expect(m.logo!.y1).toBeCloseTo(14 + 52 / 3);
    expect(m.datos).toEqual(cajaDatos(PLANTILLA_POR_DEFECTO.cabecera.datos, 3));
    // El título, alineado a la derecha en el margen.
    expect(m.titulo!.lineas).toEqual(["PRESUPUESTO"]);
    expect(m.titulo!.caja.x1).toBeCloseTo(194);
    expect(m.texto).toBeNull();
    expect(m.nombre).toBeNull();
    expect(m.dibujado).toHaveLength(3);
    // Nada baja de la línea: el cuerpo empieza 7 mm debajo de ella.
    expect(m.inicio).toBe(48 + 7);
  });

  it("sin logo sale el nombre, y no llega hasta los datos", () => {
    const m = maquetarCabecera(cabecera(), { ...contenido, logo: null }, medidas);
    expect(m.logo).toBeNull();
    expect(m.nombre).not.toBeNull();
    expect(m.nombre!.caja.x0).toBe(16);
    expect(m.nombre!.caja.x1).toBeLessThanOrEqual(m.datos!.x0 - 6);
  });

  it("el nombre «siempre» sale aunque haya logo, y «nunca» no sale aunque no lo haya", () => {
    const siempre = maquetarCabecera(
      cabecera((c) => (c.nombre.mostrar = "siempre")),
      contenido,
      medidas,
    );
    expect(siempre.logo).not.toBeNull();
    expect(siempre.nombre).not.toBeNull();
    const nunca = maquetarCabecera(
      cabecera((c) => (c.nombre.mostrar = "nunca")),
      { ...contenido, logo: null },
      medidas,
    );
    expect(nunca.nombre).toBeNull();
  });

  it("un logo que no se pone no cuenta, aunque lo haya", () => {
    const m = maquetarCabecera(
      cabecera((c) => (c.logo.mostrar = false)),
      contenido,
      medidas,
    );
    expect(m.logo).toBeNull();
    expect(m.nombre).not.toBeNull();
  });

  it("el cuerpo empieza bajo la imagen del logo, no bajo su caja entera", () => {
    // Una caja de 60 mm de alto con un logo de 3:1: la imagen solo baja 22 mm.
    const m = maquetarCabecera(
      cabecera((c) => (c.logo = { ...c.logo, x: 16, y: 12, ancho: 66, alto: 60 })),
      contenido,
      medidas,
    );
    expect(m.logo!.y1).toBeCloseTo(12 + 22);
    expect(m.inicio).toBe(48 + 7);
    // Si solo se sabe la caja (el logo no ha cargado), se cuenta la caja entera.
    const sinTamano = maquetarCabecera(
      cabecera((c) => (c.logo = { ...c.logo, x: 16, y: 12, ancho: 66, alto: 60 })),
      { ...contenido, logo: { ancho: 66, alto: 60 } },
      medidas,
    );
    expect(sinTamano.inicio).toBeCloseTo(12 + 60 + 6);
  });

  it("el título vacío o los datos sin filas no salen ni estorban", () => {
    const m = maquetarCabecera(
      cabecera((c) => (c.titulo.texto = "   ")),
      { ...contenido, logo: null, filasDatos: 0 },
      medidas,
    );
    expect(m.titulo).toBeNull();
    expect(m.datos).toBeNull();
    // Sin nada a su derecha, el nombre tiene hasta el margen.
    expect(m.nombre!.tamano).toBe(18);
    expect(m.dibujado).toEqual([m.nombre!.caja]);
  });

  it("el texto libre se parte antes de los datos y empuja el cuerpo, como en el PDF", () => {
    const parrafos = [
      "Impresión DTF por metros para profesionales del textil y la personalización",
      "Envíos en 24 horas a toda la península con seguimiento del pedido",
      "Atención de lunes a viernes de nueve a dos y de cuatro a siete",
    ];
    const m = maquetarCabecera(
      cabecera((c) => (c.texto = { ...c.texto, mostrar: true, tamano: 16 })),
      { ...contenido, parrafos },
      medidas,
    );
    const t = m.texto!;
    // No cabe en tres líneas: sale en más, y nunca pasa de los datos (con su hueco).
    expect(t.lineas.length).toBeGreaterThan(3);
    expect(t.caja.x1).toBeLessThanOrEqual(m.datos!.x0 - 6 + 1e-9);
    expect(t.caja.y1).toBeCloseTo(42 + (t.lineas.length - 1) * altoLinea(16) + bajada(16));
    expect(m.inicio).toBeCloseTo(t.caja.y1 + 6);
  });

  it("un texto libre oculto, o sin párrafos, no sale", () => {
    expect(maquetarCabecera(cabecera(), { ...contenido, parrafos: ["Hola"] }, medidas).texto).toBe(
      null,
    );
    expect(
      maquetarCabecera(
        cabecera((c) => (c.texto.mostrar = true)),
        { ...contenido, parrafos: [] },
        medidas,
      ).texto,
    ).toBeNull();
  });
});

describe("encajarEnCabecera y partirTextoLibre", () => {
  const datos = cajaDatos(PLANTILLA_POR_DEFECTO.cabecera.datos, 3);

  it("un nombre largo se encoge antes de pisar lo que tiene al lado", () => {
    const ancla = { x: 16, y: 34, tamano: 18, alineacion: "izquierda" as const };
    const largo = "Estampaciones y Serigrafía del Norte";
    const libre = encajarEnCabecera(ancla, largo, "bold", encajeNombre(18), [], medidas)!;
    const conDatos = encajarEnCabecera(ancla, largo, "bold", encajeNombre(18), [datos], medidas)!;
    expect(libre.tamano).toBe(18);
    expect(conDatos.caja.x1).toBeLessThanOrEqual(datos.x0 - 6 + 1e-9);
    expect(conDatos.tamano * conDatos.lineas.length).toBeLessThan(18 * 2);
  });

  it("el título se queda en una línea: más pequeño, hasta 6 pt", () => {
    const ancla = { x: 194, y: 34, tamano: 24, alineacion: "derecha" as const };
    const t = encajarEnCabecera(ancla, "PRESUPUESTO", "bold", ENCAJE_TITULO, [], medidas)!;
    expect(t.lineas).toEqual(["PRESUPUESTO"]);
    const estrecho = encajarEnCabecera(
      ancla,
      "PRESUPUESTO",
      "bold",
      ENCAJE_TITULO,
      [{ x0: 0, y0: 20, x1: 160, y1: 40 }],
      medidas,
    )!;
    expect(estrecho.lineas).toHaveLength(1);
    expect(estrecho.tamano).toBeLessThan(24);
    expect(estrecho.caja.x0).toBeGreaterThanOrEqual(166 - 1e-9);
  });

  it("la caja de un texto va de la subida de su primera línea a la bajada de la última", () => {
    const ancla = { x: 16, y: 42, tamano: 10, alineacion: "izquierda" as const };
    const t = partirTextoLibre(ancla, ["Uno", "Dos"], [], medidas)!;
    expect(t.lineas).toEqual(["Uno", "Dos"]);
    expect(t.caja.y0).toBeCloseTo(42 - subida(10));
    expect(t.caja.y1).toBeCloseTo(42 + altoLinea(10) + bajada(10));
    expect(partirTextoLibre(ancla, [], [], medidas)).toBeNull();
  });
});

describe("limitesEnPapel", () => {
  const rango = { minX: 0, maxX: 210, minY: 0, maxY: 297 };

  it("un texto alineado a la izquierda no pasa del borde derecho con su caja", () => {
    // «Tienda Uno» de 16 a 51 mm: su punto no pasa de 210 − 35.
    const l = limitesEnPapel({ x: 16, y: 24 }, { x0: 16, y0: 17.8, x1: 51, y1: 25.3 }, rango);
    expect(l.maxX).toBeCloseTo(175);
    expect(l.minX).toBe(0);
    expect(l.minY).toBeCloseTo(24 - 17.8);
  });

  it("uno alineado a la derecha puede anclarse en el borde, pero no salirse por la izquierda", () => {
    const l = limitesEnPapel({ x: 194, y: 23 }, { x0: 150, y0: 17, x1: 194, y1: 25 }, rango);
    expect(l.maxX).toBe(210);
    expect(l.minX).toBe(44);
  });

  it("el logo: su caja entera dentro del papel, y dentro de su rango", () => {
    const l = limitesEnPapel(
      { x: 16, y: 14 },
      { x0: 16, y0: 14, x1: 68, y1: 36 },
      { minX: 0, maxX: 150, minY: 0, maxY: 297 },
    );
    expect(l.maxX).toBe(150);
    expect(l.maxY).toBe(297 - 22);
  });

  it("hasta dónde baja se puede limitar (el fondo del dibujo al arrastrar)", () => {
    const l = limitesEnPapel({ x: 16, y: 14 }, { x0: 16, y0: 14, x1: 68, y1: 36 }, rango, {
      alto: 60,
    });
    expect(l.maxY).toBe(60 - 22);
  });

  it("sin caja, solo el rango; con una caja más grande que el papel, pegada al principio", () => {
    expect(limitesEnPapel({ x: 50, y: 50 }, null, rango)).toEqual(rango);
    const l = limitesEnPapel({ x: 10, y: 10 }, { x0: 0, y0: 10, x1: 230, y1: 20 }, rango);
    expect(l.minX).toBe(10);
    expect(l.maxX).toBe(10);
  });
});
