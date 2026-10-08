import { describe, expect, it } from "vitest";
import {
  claseDeTipo,
  deCompra,
  deFacturaTextil,
  deFacturaTienda,
  entraEnArchivo,
  extensionDe,
  filasIndice,
  nombreZip,
  resumenArchivo,
  rutaEnZip,
  rutasEnZip,
  sanearNombre,
  trimestreDe,
  type DocArchivo,
} from "./archivo";
import { rangoDe, type Seleccion } from "./periodos";

const venta = (extra: Partial<DocArchivo> = {}): DocArchivo => ({
  origen: "tienda",
  clase: "emitida",
  id: "f1",
  fecha: "2026-08-14",
  referencia: "2026/0012",
  tercero: "Club Náutico",
  nif: "B00000000",
  procedencia: "Tienda Uno",
  base: 100,
  iva: 21,
  total: 121,
  estado: "emitida",
  ext: "pdf",
  tieneFichero: true,
  ...extra,
});

describe("trimestreDe", () => {
  it("lee el trimestre del texto, sin husos horarios", () => {
    expect(trimestreDe("2026-01-01")).toBe("2026-T1");
    expect(trimestreDe("2026-03-31")).toBe("2026-T1");
    expect(trimestreDe("2026-04-01")).toBe("2026-T2");
    expect(trimestreDe("2026-08-14")).toBe("2026-T3");
    expect(trimestreDe("2026-12-31T23:30:00Z")).toBe("2026-T4");
  });
  it("sin fecha, a su carpeta", () => {
    expect(trimestreDe(null)).toBe("sin-fecha");
    expect(trimestreDe("")).toBe("sin-fecha");
    expect(trimestreDe("2026-13-01")).toBe("sin-fecha");
  });
});

describe("sanearNombre", () => {
  it("quita tildes, eñes, barras y espacios", () => {
    expect(sanearNombre("Peña Sport, S.L.")).toBe("Pena-Sport-S.L");
    expect(sanearNombre("2026/0012")).toBe("2026-0012");
    expect(sanearNombre("  Café «El Rincón» ")).toBe("Cafe-El-Rincon");
  });
  it("nunca devuelve vacío y respeta el tope", () => {
    expect(sanearNombre("")).toBe("sin-nombre");
    expect(sanearNombre(null)).toBe("sin-nombre");
    expect(sanearNombre("///")).toBe("sin-nombre");
    expect(sanearNombre("a".repeat(100), 10)).toBe("aaaaaaaaaa");
  });
});

describe("extensionDe", () => {
  it("la de la ruta, en minúsculas; pdf si no hay", () => {
    expect(extensionDe("ronoca/2026/x.JPG")).toBe("jpg");
    expect(extensionDe("ronoca/2026/x.pdf")).toBe("pdf");
    expect(extensionDe(null)).toBe("pdf");
    expect(extensionDe("sin-extension")).toBe("pdf");
  });
});

describe("rutaEnZip", () => {
  it("ventas: carpeta de la clase y del trimestre, referencia y cliente", () => {
    expect(rutaEnZip(venta())).toBe("emitidas/2026-T3/2026-0012_Club-Nautico.pdf");
    expect(rutaEnZip(venta({ clase: "ticket", referencia: "T2026/0045", tercero: null }))).toBe(
      "tickets/2026-T3/T2026-0045.pdf",
    );
    expect(rutaEnZip(venta({ clase: "rectificativa", referencia: "R2026/0001" }))).toBe(
      "rectificativas/2026-T3/R2026-0001_Club-Nautico.pdf",
    );
  });
  it("compras: fecha, proveedor y número, con la extensión real", () => {
    const c = deCompra({
      id: "c1",
      fecha: "2026-07-14",
      proveedor: "Proveedor S.L.",
      numero: "FAC-123",
      fichero_ruta: "ronoca/2026/c1.jpg",
      estado: "registrada",
    });
    expect(rutaEnZip(c)).toBe("compras/2026-T3/2026-07-14_Proveedor-S.L_FAC-123.jpg");
    expect(rutaEnZip({ ...c, fecha: null })).toBe(
      "compras/sin-fecha/sin-fecha_Proveedor-S.L_FAC-123.jpg",
    );
  });
});

describe("rutasEnZip", () => {
  it("no deja dos ficheros con el mismo nombre", () => {
    const a = venta({ id: "a", referencia: "", tercero: "X" });
    const b = venta({ id: "b", referencia: "", tercero: "X" });
    const c = venta({ id: "c", referencia: "", tercero: "x" });
    expect(rutasEnZip([a, b, c])).toEqual([
      "emitidas/2026-T3/sin-nombre_X.pdf",
      "emitidas/2026-T3/sin-nombre_X_2.pdf",
      // Windows no distingue mayúsculas: también cuenta como repetido.
      "emitidas/2026-T3/sin-nombre_x_3.pdf",
    ]);
  });
});

describe("nombreZip", () => {
  const ref = new Date(2026, 7, 14);
  const nombre = (sel: Seleccion) => nombreZip(sel, rangoDe(sel));
  it("según el periodo", () => {
    expect(nombre({ tipo: "trimestre", ref })).toBe("Archivo_2026-T3.zip");
    expect(nombre({ tipo: "mes", ref })).toBe("Archivo_2026-08.zip");
    expect(nombre({ tipo: "anio", ref })).toBe("Archivo_2026.zip");
    expect(nombre({ tipo: "hoy", ref })).toBe("Archivo_2026-08-14.zip");
    expect(nombre({ tipo: "todo", ref })).toBe("Archivo_completo.zip");
    expect(
      nombre({ tipo: "libre", ref, desde: new Date(2026, 6, 1), hasta: new Date(2026, 8, 30) }),
    ).toBe("Archivo_2026-07-01_a_2026-09-30.zip");
  });
  it("con otro prefijo", () => {
    expect(nombreZip({ tipo: "mes", ref }, rangoDe({ tipo: "mes", ref }), "Compras")).toBe(
      "Compras_2026-08.zip",
    );
  });
});

describe("de cada tabla al archivo", () => {
  it("una factura de tienda", () => {
    const d = deFacturaTienda(
      {
        id: "f1",
        tipo: "simplificada",
        estado: "pagada",
        fecha: "2026-10-05",
        cliente_nombre: null,
        base_imponible: "35.95",
        iva_total: 7.55,
        total: 43.5,
        pdf_url: "tienda/f1.pdf",
      },
      "T2026/0001",
      "Tienda Uno",
    );
    expect(d).toMatchObject({
      origen: "tienda",
      clase: "ticket",
      base: 35.95,
      total: 43.5,
      tieneFichero: true,
      procedencia: "Tienda Uno",
    });
    expect(deFacturaTienda({ id: "f2" }, "—", null).tieneFichero).toBe(false);
  });
  it("una textil, con su marca", () => {
    expect(
      deFacturaTextil({
        id: "t1",
        numero: "FT-2026-0001",
        tipo: "ordinaria",
        subtotal: 10,
        iva: 2.1,
        total: 12.1,
        marca: { nombre: "Marca A" },
      }),
    ).toMatchObject({ clase: "emitida", procedencia: "Textil · Marca A", tieneFichero: false });
  });
  it("una compra cuenta el líquido si lo hay", () => {
    expect(deCompra({ id: "c", total: 121, liquido: 106 }).total).toBe(106);
    expect(deCompra({ id: "c", total: 121 }).total).toBe(121);
  });
  it("clase por tipo", () => {
    expect(claseDeTipo("ordinaria")).toBe("emitida");
    expect(claseDeTipo("simplificada")).toBe("ticket");
    expect(claseDeTipo("rectificativa")).toBe("rectificativa");
    expect(claseDeTipo(null)).toBe("emitida");
  });
});

describe("entraEnArchivo", () => {
  it("fuera los borradores y las compras borradas o sin registrar", () => {
    expect(entraEnArchivo(venta())).toBe(true);
    expect(entraEnArchivo(venta({ estado: "anulada" }))).toBe(true);
    expect(entraEnArchivo(venta({ estado: "borrador" }))).toBe(false);
    expect(entraEnArchivo(deCompra({ id: "c", estado: "registrada" }))).toBe(true);
    expect(entraEnArchivo(deCompra({ id: "c", estado: "borrador" }))).toBe(false);
    expect(
      entraEnArchivo(deCompra({ id: "c", estado: "registrada", borrada_en: "2026-10-01" })),
    ).toBe(false);
  });
});

describe("resumen e índice", () => {
  it("cuenta por clase y los que no tienen fichero", () => {
    const r = resumenArchivo([
      venta(),
      venta({ clase: "ticket", tieneFichero: false }),
      deCompra({ id: "c", estado: "registrada" }),
    ]);
    expect(r).toEqual({
      total: 3,
      porClase: { emitida: 1, ticket: 1, rectificativa: 0, compra: 1 },
      sinFichero: 2,
    });
  });
  it("una fila por documento, con su ruta o el aviso de que falta", () => {
    const filas = filasIndice([venta(), venta({ id: "b" })], ["emitidas/x.pdf", null], (n) =>
      n.toFixed(2),
    );
    expect(filas[0][0]).toBe("Fichero");
    expect(filas[1]).toEqual([
      "emitidas/x.pdf",
      "Facturas emitidas",
      "Tienda Uno",
      "2026/0012",
      "2026-08-14",
      "Club Náutico",
      "B00000000",
      "100.00",
      "21.00",
      "121.00",
      "emitida",
    ]);
    expect(filas[2][0]).toBe("(falta el fichero)");
  });
});
