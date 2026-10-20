import { describe, expect, it } from "vitest";
import {
  LADO_MINIMO_EXTRAIDA,
  MAXIMO_BYTES_IMAGEN,
  extraerJpegsDePdf,
  maquetarImagenes,
  medidasImagen,
  revisarImagen,
  rutaImagenPresupuesto,
} from "./imagenes-presupuesto";

/** Un JPEG mínimo: SOI, APP0, SOF0 con sus medidas y EOI. */
function jpeg(ancho: number, alto: number, componentes = 3, relleno = 0): Uint8Array {
  const app0 = [
    0xff,
    0xe0,
    0x00,
    0x10,
    ...Array.from("JFIF\0", (c) => c.charCodeAt(0)),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ];
  const sof = [
    0xff,
    0xc0,
    0x00,
    8 + 3 * componentes,
    8,
    alto >> 8,
    alto & 0xff,
    ancho >> 8,
    ancho & 0xff,
    componentes,
    ...Array.from({ length: componentes * 3 }, () => 0x11),
  ];
  const datos = Array.from({ length: relleno }, (_, i) => i % 200);
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...datos, 0xff, 0xd9]);
}

function png(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, ancho);
  new DataView(b.buffer).setUint32(20, alto);
  return b;
}

function webpVp8x(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    Array.from("RIFF", (c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    Array.from("WEBPVP8X", (c) => c.charCodeAt(0)),
    8,
  );
  const a = ancho - 1;
  const h = alto - 1;
  b.set(
    [a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
    24,
  );
  return b;
}

const texto = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const unir = (...partes: Uint8Array[]) => {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const r = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    r.set(p, i);
    i += p.length;
  }
  return r;
};

/** Un objeto imagen de PDF con el diccionario dado y el JPEG dentro. */
const objetoImagen = (n: number, dicc: string, datos: Uint8Array) =>
  unir(
    texto(`${n} 0 obj\n<< ${dicc} /Length ${datos.length} >>\nstream\n`),
    datos,
    texto("\nendstream\nendobj\n"),
  );

describe("medidasImagen", () => {
  it("lee el tipo y las medidas de un JPEG, un PNG y un WEBP por sus bytes", () => {
    expect(medidasImagen(jpeg(640, 480))).toEqual({
      tipo: "image/jpeg",
      ancho: 640,
      alto: 480,
      componentes: 3,
    });
    expect(medidasImagen(png(1200, 300))).toEqual({ tipo: "image/png", ancho: 1200, alto: 300 });
    expect(medidasImagen(webpVp8x(2000, 1500))).toEqual({
      tipo: "image/webp",
      ancho: 2000,
      alto: 1500,
    });
  });

  it("un PDF o un texto no es una imagen", () => {
    expect(medidasImagen(texto("%PDF-1.7\n"))).toBeNull();
    expect(medidasImagen(texto("hola"))).toBeNull();
    expect(medidasImagen(new Uint8Array())).toBeNull();
  });
});

describe("revisarImagen", () => {
  it("acepta una imagen normal y rechaza la vacía, la enorme, la que no es imagen y la CMYK", () => {
    expect(revisarImagen(jpeg(10, 10), "a.jpg").ok).toBe(true);
    expect(revisarImagen(new Uint8Array(), "b.jpg")).toEqual({
      ok: false,
      error: "«b.jpg» está vacío.",
    });
    const enorme = new Uint8Array(MAXIMO_BYTES_IMAGEN + 1);
    expect(revisarImagen(enorme, "c.jpg").ok).toBe(false);
    expect(revisarImagen(texto("%PDF-1.7"), "d.png").ok).toBe(false);
    const cmyk = revisarImagen(jpeg(10, 10, 4), "e.jpg");
    expect(cmyk.ok).toBe(false);
    if (!cmyk.ok) expect(cmyk.error).toContain("CMYK");
  });
});

describe("rutaImagenPresupuesto", () => {
  it("empresa/ámbito/presupuesto/id.extensión, como pide el CHECK de la tabla", () => {
    const e = "11111111-1111-4111-8111-111111111111";
    const p = "22222222-2222-4222-8222-222222222222";
    const i = "33333333-3333-4333-8333-333333333333";
    const ruta = rutaImagenPresupuesto(e, "textil", p, i, "image/webp");
    expect(ruta).toBe(`${e}/textil/${p}/${i}.webp`);
    expect(ruta).toMatch(
      /^[0-9a-f-]{36}\/(tienda|textil)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/,
    );
  });
});

describe("extraerJpegsDePdf", () => {
  const foto = jpeg(800, 600, 3, 300);
  const pdf = unir(
    texto("%PDF-1.7\n"),
    objetoImagen(
      1,
      "/Type /XObject /Subtype /Image /Width 800 /Height 600 /Filter /DCTDecode",
      foto,
    ),
    // La misma foto otra vez: sale una.
    objetoImagen(2, "/Type /XObject /Subtype /Image /Filter [/DCTDecode]", foto),
    // Un icono: demasiado pequeño.
    objetoImagen(3, "/Subtype /Image /Filter /DCTDecode", jpeg(40, 40, 3, 10)),
    // CMYK: fuera.
    objetoImagen(
      4,
      "/Subtype /Image /ColorSpace /DeviceCMYK /Filter /DCTDecode",
      jpeg(900, 900, 4, 20),
    ),
    // Con otro filtro delante: fuera (habría que descomprimir).
    objetoImagen(5, "/Subtype /Image /Filter [/FlateDecode /DCTDecode]", jpeg(900, 900, 3, 30)),
    // Colores invertidos: fuera.
    objetoImagen(6, "/Subtype /Image /Decode [1 0] /Filter /DCTDecode", jpeg(900, 700, 3, 40)),
    // Un JPEG que no es imagen (una fuente, otro objeto): fuera.
    objetoImagen(7, "/Type /EmbeddedFile /Filter /DCTDecode", jpeg(900, 700, 3, 50)),
    // Otra foto buena, en escala de grises.
    objetoImagen(
      8,
      "/Subtype/Image/Filter/DCTDecode/ColorSpace/DeviceGray",
      jpeg(300, 1200, 1, 60),
    ),
    texto("trailer\n%%EOF\n"),
  );

  it("saca las fotos JPEG enteras, sin repetidas, ni iconos, ni CMYK, ni las dudosas", () => {
    const r = extraerJpegsDePdf(pdf);
    expect(r.map((x) => [x.ancho, x.alto])).toEqual([
      [800, 600],
      [300, 1200],
    ]);
    expect(Array.from(r[0].bytes)).toEqual(Array.from(foto));
    expect(LADO_MINIMO_EXTRAIDA).toBeGreaterThan(40);
  });

  it("un PDF sin imágenes, o que no es un PDF, no da ninguna", () => {
    expect(
      extraerJpegsDePdf(
        texto("%PDF-1.7\n1 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n"),
      ),
    ).toEqual([]);
    expect(extraerJpegsDePdf(texto("hola"))).toEqual([]);
  });
});

describe("maquetarImagenes", () => {
  it("dos por fila, cada una en su hueco, sin deformar y centrada", () => {
    const filas = maquetarImagenes(
      [
        { ancho: 1000, alto: 500 },
        { ancho: 500, alto: 1000 },
        { ancho: 800, alto: 800 },
      ],
      186,
      { separacion: 6, altoMaximo: 80 },
    );
    expect(filas).toHaveLength(2);
    const [a, b] = filas[0].celdas;
    // Hueco de 90 mm: la apaisada llena el ancho; la vertical, el alto máximo.
    expect(a).toMatchObject({ indice: 0, x: 0, ancho: 90, alto: 45 });
    expect(b.alto).toBe(80);
    expect(b.ancho).toBe(40);
    expect(b.x).toBe(96 + 25);
    expect(filas[0].alto).toBe(80);
    expect(filas[1].celdas[0]).toMatchObject({ indice: 2, ancho: 80, alto: 80 });
  });

  it("una sola imagen va a todo lo ancho; sin imágenes, nada", () => {
    const [fila] = maquetarImagenes([{ ancho: 2000, alto: 500 }], 186, { altoMaximo: 80 });
    expect(fila.celdas[0]).toMatchObject({ x: 0, ancho: 186, alto: 46.5 });
    expect(maquetarImagenes([], 186)).toEqual([]);
    expect(maquetarImagenes([{ ancho: 0, alto: 10 }], 186)).toEqual([]);
  });
});
