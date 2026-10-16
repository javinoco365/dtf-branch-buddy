import { describe, expect, it } from "vitest";
import {
  ENCAJE_TITULO,
  RAYA_ANTETITULO,
  encajarEnCabecera,
  encajeNombre,
  limitesEnPapel,
  maquetarCabecera,
  maquetarDatos,
  partirTextoLibre,
  textosDatos,
  type MedidasTexto,
} from "./maqueta-cabecera";
import {
  ALTO_PASTILLA,
  SOMBRA_PASTILLA,
  altoLinea,
  bajada,
  encajarImagen,
  subida,
  type Medir,
  type Partir,
} from "./maqueta-presupuesto";
import { PLANTILLA_POR_DEFECTO, type PlantillaPresupuesto } from "./plantilla-presupuesto";

// Una fuente de mentira: cada carácter mide medio punto en mm (todas las letras, igual).
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
const datos = textosDatos(PLANTILLA_POR_DEFECTO.cabecera, {
  numero: "PRE-2026-1016-01",
  fecha: "16/10/2026",
  validez: "15/11/2026",
}).map((d) => d.texto);
const contenido = {
  logo: { ancho: 100, alto: 100 },
  datos,
  parrafos: [] as string[],
  nombre: "Tienda Uno",
};

describe("textosDatos", () => {
  it("cada pastilla con su etiqueta delante; la de validez, marcada", () => {
    expect(
      textosDatos(PLANTILLA_POR_DEFECTO.cabecera, { numero: "N1", fecha: "F", validez: "V" }),
    ).toEqual([
      { texto: "Nº N1", validez: false },
      { texto: "Fecha F", validez: false },
      { texto: "Válido hasta V", validez: true },
    ]);
  });
  it("una etiqueta vacía quita su pastilla", () => {
    const c = cabecera((c) => (c.datos.etiquetaFecha = " "));
    expect(textosDatos(c, { numero: "N1", fecha: "F", validez: "V" })).toHaveLength(2);
  });
});

describe("maquetarCabecera", () => {
  it("con la plantilla de por defecto y logo: logo, datos, título y antetítulo; el nombre no", () => {
    const c = cabecera((c) => (c.texto.texto = "Presupuesto"));
    const m = maquetarCabecera(c, { ...contenido, parrafos: ["Presupuesto"] }, medidas);
    // El logo, cuadrado, encajado en su caja de 52 × 21: 21 × 21, a la izquierda.
    expect(m.logo).toEqual(encajarImagen(PLANTILLA_POR_DEFECTO.cabecera.logo, contenido.logo));
    expect(m.logo!.x1 - m.logo!.x0).toBeCloseTo(21);
    // Las tres pastillas en una fila, acabando en el margen derecho.
    expect(m.datos!.pastillas).toHaveLength(3);
    const ultima = m.datos!.pastillas[2];
    expect(ultima.x + ultima.ancho).toBeCloseTo(196);
    expect(m.datos!.caja.y1).toBeCloseTo(25.1 + ALTO_PASTILLA + SOMBRA_PASTILLA);
    // El título, alineado a la derecha en el margen.
    expect(m.titulo!.lineas).toEqual(["PRESUPUESTO"]);
    expect(m.titulo!.caja.x1).toBeCloseTo(196);
    // El antetítulo, en mayúsculas y con la raya delante.
    expect(m.texto!.lineas).toEqual(["PRESUPUESTO"]);
    expect(m.texto!.caja.x0).toBeCloseTo(
      196 - medir("PRESUPUESTO", 7.5) - RAYA_ANTETITULO.largo - RAYA_ANTETITULO.hueco,
    );
    expect(m.nombre).toBeNull();
    // La cabecera acaba con la cinta, y el cuerpo empieza 5 mm debajo.
    expect(m.fin).toBeCloseTo(38 + 8.9);
    expect(m.inicio).toBeCloseTo(38 + 8.9 + 5);
  });

  it("sin cinta, la cabecera acaba en la banda", () => {
    const m = maquetarCabecera(
      cabecera((c) => (c.cinta.mostrar = false)),
      contenido,
      medidas,
    );
    expect(m.fin).toBe(38);
    expect(m.inicio).toBe(43);
  });

  it("sin logo sale el nombre, y no llega hasta las pastillas", () => {
    const m = maquetarCabecera(cabecera(), { ...contenido, logo: null }, medidas);
    expect(m.logo).toBeNull();
    expect(m.nombre).not.toBeNull();
    expect(m.nombre!.caja.x0).toBe(14);
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

  it("lo que baja de la banda empuja el cuerpo", () => {
    const m = maquetarCabecera(
      cabecera((c) => (c.logo = { ...c.logo, x: 14, y: 12, ancho: 60, alto: 60 })),
      contenido,
      medidas,
    );
    expect(m.logo!.y1).toBeCloseTo(72);
    expect(m.inicio).toBeCloseTo(72 + 6);
  });

  it("el título vacío o los datos sin pastillas no salen ni estorban", () => {
    const m = maquetarCabecera(
      cabecera((c) => {
        c.titulo.texto = "   ";
        c.texto.mostrar = false;
      }),
      { ...contenido, logo: null, datos: [] },
      medidas,
    );
    expect(m.titulo).toBeNull();
    expect(m.datos).toBeNull();
    expect(m.nombre!.tamano).toBe(24);
    expect(m.dibujado).toEqual([m.nombre!.caja]);
  });

  it("un antetítulo oculto, o sin párrafos, no sale", () => {
    expect(
      maquetarCabecera(
        cabecera((c) => (c.texto.mostrar = false)),
        { ...contenido, parrafos: ["Hola"] },
        medidas,
      ).texto,
    ).toBeNull();
    expect(maquetarCabecera(cabecera(), { ...contenido, parrafos: [] }, medidas).texto).toBeNull();
  });
});

describe("maquetarDatos", () => {
  it("en una caja estrecha, las pastillas siguen en otra fila y la caja crece", () => {
    const m = maquetarDatos({ x: 140, y: 25, ancho: 56 }, datos, medir)!;
    expect(new Set(m.pastillas.map((p) => p.y)).size).toBeGreaterThan(1);
    expect(m.caja.y1).toBeGreaterThan(25 + ALTO_PASTILLA + SOMBRA_PASTILLA);
    for (const p of m.pastillas) {
      expect(p.x).toBeGreaterThanOrEqual(140 - 1e-9);
      expect(p.x + p.ancho).toBeLessThanOrEqual(196 + 1e-9);
    }
  });
  it("sin textos, nada", () => {
    expect(maquetarDatos({ x: 70, y: 25, ancho: 126 }, [], medir)).toBeNull();
  });
});

describe("encajarEnCabecera y partirTextoLibre", () => {
  const obstaculo = { x0: 70, y0: 10, x1: 196, y1: 40 };

  it("un nombre largo se encoge antes de pisar lo que tiene al lado", () => {
    const ancla = { x: 14, y: 22, tamano: 24, alineacion: "izquierda" as const };
    const largo = "Estampaciones y Serigrafía del Norte";
    const libre = encajarEnCabecera(ancla, largo, "titular", encajeNombre(24), [], medidas)!;
    const conDatos = encajarEnCabecera(
      ancla,
      largo,
      "titular",
      encajeNombre(24),
      [obstaculo],
      medidas,
    )!;
    expect(libre.tamano).toBe(24);
    expect(conDatos.caja.x1).toBeLessThanOrEqual(obstaculo.x0 - 6 + 1e-9);
    expect(conDatos.tamano * conDatos.lineas.length).toBeLessThan(24 * 2);
  });

  it("el título se queda en una línea: más pequeño, hasta 6 pt", () => {
    const ancla = { x: 196, y: 22, tamano: 34, alineacion: "derecha" as const };
    const t = encajarEnCabecera(ancla, "PRESUPUESTO", "titular", ENCAJE_TITULO, [], medidas)!;
    expect(t.lineas).toEqual(["PRESUPUESTO"]);
    const estrecho = encajarEnCabecera(
      ancla,
      "PRESUPUESTO",
      "titular",
      ENCAJE_TITULO,
      [{ x0: 0, y0: 5, x1: 160, y1: 30 }],
      medidas,
    )!;
    expect(estrecho.lineas).toHaveLength(1);
    expect(estrecho.tamano).toBeLessThan(34);
    expect(estrecho.caja.x0).toBeGreaterThanOrEqual(166 - 1e-9);
  });

  it("la caja del antetítulo va de la subida de su primera línea a la bajada de la última", () => {
    const ancla = { x: 14, y: 42, tamano: 10, alineacion: "izquierda" as const };
    const t = partirTextoLibre(ancla, ["Uno", "Dos"], [], medidas)!;
    expect(t.lineas).toEqual(["UNO", "DOS"]);
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
