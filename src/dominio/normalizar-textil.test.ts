import { describe, expect, it } from "vitest";
import {
  ACENTOS,
  SIN_ACENTOS,
  STOPWORDS,
  cifrasEan,
  claveMemoria,
  claveMemoriaDescripcion,
  claveNif,
  claveTalla,
  claveTexto,
  eanValido,
  normalizarEan,
  packDesdeTexto,
  palabras,
  tipoDeLinea,
} from "./normalizar-textil";

// Vectores compartidos con supabase/pruebas/C18_escaner_textil.sql (caso 1):
// la base y el dominio tienen que dar exactamente esto (I7).
describe("vectores compartidos con la prueba SQL", () => {
  it.each([
    ["  Camiseta Básica  Ñandú ", "camisetabasicanandu"],
    [null, ""],
    ["B&C #E190", "bce190"],
  ])("claveTexto(%j) = %j", (entrada, salida) => {
    expect(claveTexto(entrada)).toBe(salida);
  });

  it.each([
    ["xxl", "2XL"],
    ["Talla M", "M"],
    ["3-4 años", "34"],
    ["T.U.", "UNICA"],
    ["One Size", "UNICA"],
    ["Única", "UNICA"],
    ["XXXL", "3XL"],
    ["2XL", "2XL"],
    [null, ""],
  ])("claveTalla(%j) = %j", (entrada, salida) => {
    expect(claveTalla(entrada)).toBe(salida);
  });

  it.each([
    ["es-b12.345.678", "B12345678"],
    ["B-12345678", "B12345678"],
    [" 12345678z ", "12345678Z"],
    ["ESX1234567L", "X1234567L"],
    [null, ""],
  ])("claveNif(%j) = %j", (entrada, salida) => {
    expect(claveNif(entrada)).toBe(salida);
  });

  it.each([
    [
      { referencia: "5000", color: "Black", talla: "XXL", descripcion: "Camiseta" },
      "r:5000|black|2XL",
    ],
    [
      { referencia: null, color: "Negro", talla: "L", descripcion: "Camiseta Heavy Negro L" },
      "d:camisetaheavynegrol|negro|L",
    ],
    [
      { referencia: null, color: null, talla: null, descripcion: "Camiseta Heavy Negro L" },
      "d:camisetaheavynegrol",
    ],
    [{ referencia: null, color: null, talla: "M", descripcion: "Sudadera" }, "d:sudadera||M"],
    [{ referencia: null, color: null, talla: null, descripcion: null }, ""],
  ])("claveMemoria(%j) = %j", (entrada, salida) => {
    expect(claveMemoria(entrada)).toBe(salida);
  });
});

describe("claves de texto", () => {
  it("el mapa de acentos tiene 48 caracteres a cada lado, como translate() en SQL", () => {
    expect([...ACENTOS]).toHaveLength(48);
    expect([...SIN_ACENTOS]).toHaveLength(48);
  });

  it("traduce los acentos antes de quitar lo que no es letra ni cifra", () => {
    expect(claveTexto("ÁÉÍÓÚ àèìòù äëïöü âêîôû ãõ Çç")).toBe("aeiouaeiouaeiouaeiouaocc");
  });

  it("lo que no está en el mapa se pierde, igual que en la base", () => {
    // ø y ß no están en el mapa de 48: el regex los quita.
    expect(claveTexto("Smørrebrød Straße")).toBe("smrrebrdstrae");
  });

  it("undefined y vacío dan cadena vacía", () => {
    expect(claveTexto(undefined)).toBe("");
    expect(claveTalla("  ")).toBe("");
    expect(claveNif(undefined)).toBe("");
  });

  it("tallas: XXS, XXXXL, OS, U, years", () => {
    expect(claveTalla("xxs")).toBe("2XS");
    expect(claveTalla("XXXS")).toBe("3XS");
    expect(claveTalla("XXXXL")).toBe("4XL");
    expect(claveTalla("xxxxxl")).toBe("5XL");
    expect(claveTalla("OS")).toBe("UNICA");
    expect(claveTalla("u")).toBe("UNICA");
    expect(claveTalla("5-6 years")).toBe("56");
    expect(claveTalla("Talla 42")).toBe("42");
  });

  it("NIF: el ES solo se quita delante de un NIF español completo", () => {
    expect(claveNif("ES")).toBe("ES");
    expect(claveNif("ES123")).toBe("ES123");
    // Un NIF de otro país de la UE no pierde nada.
    expect(claveNif("FR12345678901")).toBe("FR12345678901");
  });

  it("claveMemoria: solo color, sin talla", () => {
    expect(
      claveMemoria({ referencia: undefined, color: "Rojo", talla: undefined, descripcion: "Polo" }),
    ).toBe("d:polo|rojo|");
  });

  it("claveMemoriaDescripcion", () => {
    expect(claveMemoriaDescripcion("Camiseta Heavy Negro L")).toBe("d:camisetaheavynegrol");
    expect(claveMemoriaDescripcion(" — ")).toBe("");
    expect(claveMemoriaDescripcion(null)).toBe("");
  });
});

describe("EAN", () => {
  it("dígito de control", () => {
    expect(eanValido("4006381333931")).toBe(true);
    expect(eanValido("96385074")).toBe(true);
    expect(eanValido("4006381333932")).toBe(false);
  });

  it("con espacios, se queda con las cifras", () => {
    expect(normalizarEan("4006 3813 3393 1")).toBe("4006381333931");
    expect(cifrasEan("4006 3813 3393 1")).toBe("4006381333931");
  });

  it("forma canónica: UPC-A a EAN-13 y GTIN-14 con 0 delante a EAN-13", () => {
    expect(normalizarEan("036000291452")).toBe("0036000291452");
    expect(normalizarEan("00036000291452")).toBe("0036000291452");
  });

  it("un GTIN-14 que no empieza por 0 se queda en 14", () => {
    // 1 + 0036000291452 con su dígito de control recalculado.
    expect(normalizarEan("10036000291459")).toBe("10036000291459");
  });

  it("longitudes que no son GTIN y textos sin cifras: null", () => {
    expect(normalizarEan("123")).toBeNull();
    expect(normalizarEan("12345678901")).toBeNull();
    expect(normalizarEan(null)).toBeNull();
    expect(cifrasEan("sin cifras")).toBeNull();
    expect(cifrasEan(undefined)).toBeNull();
  });
});

describe("tipoDeLinea", () => {
  it("manda lo que dice la IA si es un tipo válido", () => {
    expect(tipoDeLinea("porte", "Camiseta", 10)).toBe("porte");
    expect(tipoDeLinea("articulo", "Portes", -3)).toBe("articulo");
    expect(tipoDeLinea(" Otro ", "Tasa", 1)).toBe("otro");
  });

  it("con un tipo raro o sin tipo, importe negativo → descuento", () => {
    expect(tipoDeLinea("rebaja", "Dto. 5 %", -5)).toBe("descuento");
    expect(tipoDeLinea(null, "Camiseta", -1)).toBe("descuento");
  });

  it("portes, transporte, envío, shipping → porte", () => {
    expect(tipoDeLinea(undefined, "Portes", 10)).toBe("porte");
    expect(tipoDeLinea(undefined, "Porte agencia", 10)).toBe("porte");
    expect(tipoDeLinea(undefined, "Gastos de envío", 4.5)).toBe("porte");
    expect(tipoDeLinea(undefined, "TRANSPORTE", 4.5)).toBe("porte");
    expect(tipoDeLinea(undefined, "Shipping costs", 4.5)).toBe("porte");
    expect(tipoDeLinea(undefined, "Envio urgente", 4.5)).toBe("porte");
  });

  it("una camiseta es un artículo (y «soportes» no es un porte)", () => {
    expect(tipoDeLinea(undefined, "Camiseta Gildan 5000 Negro XL", 30)).toBe("articulo");
    expect(tipoDeLinea(undefined, "Soportes de plancha", 30)).toBe("articulo");
  });
});

describe("packDesdeTexto", () => {
  it.each([
    ["Calcetín pack 5", 5],
    ["Calcetín Pack de 5 pares", 5],
    ["Camiseta caja 10", 10],
    ["Lote de 12 gorras", 12],
    ["Bolsa 5 bolsas tote", 5],
    ["Calcetín 5 uds/pack", 5],
    ["Camiseta 10 uds por caja", 10],
  ])("%j → %d", (texto, n) => {
    expect(packDesdeTexto(texto)).toBe(n);
  });

  it("sin pack, null", () => {
    expect(packDesdeTexto("Camiseta 5000")).toBeNull();
    expect(packDesdeTexto("Backpack 5 litros")).toBeNull();
    expect(packDesdeTexto(null)).toBeNull();
    expect(packDesdeTexto("Pack de 0")).toBeNull();
  });
});

describe("palabras", () => {
  it("quita las STOPWORDS y normaliza cada palabra", () => {
    expect(palabras("Camiseta de algodón con Cuello, talla XL / color Negro")).toEqual([
      "camiseta",
      "algodon",
      "cuello",
      "xl",
      "negro",
    ]);
  });

  it("todas las STOPWORDS desaparecen", () => {
    expect(palabras(STOPWORDS.join(" "))).toEqual([]);
    expect(palabras(null)).toEqual([]);
  });
});
