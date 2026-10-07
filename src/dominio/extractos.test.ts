import { describe, expect, it } from "vitest";
import {
  aFechaCon,
  aNumeroCon,
  cuadreExtracto,
  decodificar,
  detectarDecimal,
  detectarOrdenFecha,
  detectarSeparador,
  esNorma43,
  extractoDeFilas,
  huellaMovimiento,
  leerExtractoTexto,
  leerNorma43,
  normalizarIban,
  saldosDeMovimientos,
} from "./extractos";

const bytes = (t: string) => new TextEncoder().encode(t);
// IBAN de ejemplo (el de la documentación del Banco de España), por partes:
// así el número completo no aparece escrito en el código.
const IBAN = ["ES91", "2100", "0418", "4502", "0005", "1332"];

describe("codificación", () => {
  it("UTF-8, con y sin BOM", () => {
    expect(decodificar(bytes("Señor")).codificacion).toBe("UTF-8");
    expect(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Ñ")]))).toEqual({
      texto: "Ñ",
      codificacion: "UTF-8",
    });
  });
  it("Windows-1252 (Excel español): la ñ no es UTF-8 válido", () => {
    // «Señor» en Windows-1252: la ñ es 0xF1.
    const r = decodificar(new Uint8Array([0x53, 0x65, 0xf1, 0x6f, 0x72]));
    expect(r).toEqual({ texto: "Señor", codificacion: "Windows-1252" });
  });
  it("UTF-16 con BOM y sin él", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xf1, 0x00]);
    expect(decodificar(le)).toEqual({ texto: "Añ", codificacion: "UTF-16LE" });
    const sinBom = new Uint8Array([0x46, 0x00, 0x65, 0x00, 0x63, 0x00, 0x68, 0x00, 0x61, 0x00]);
    expect(decodificar(sinBom)).toEqual({ texto: "Fecha", codificacion: "UTF-16LE" });
  });
});

describe("fechas: se detecta el orden, no se supone", () => {
  it("día/mes si algún primer número pasa de 12; mes/día si el segundo", () => {
    expect(detectarOrdenFecha(["03/10/2026", "25/10/2026"])).toEqual({
      orden: "dma",
      ambiguo: false,
    });
    expect(detectarOrdenFecha(["10/03/2026", "10/25/2026"])).toEqual({
      orden: "mda",
      ambiguo: false,
    });
    expect(detectarOrdenFecha(["2026-10-25", "2026-10-03"])).toEqual({
      orden: "amd",
      ambiguo: false,
    });
  });
  it("si ninguno pasa de 12 no se puede saber: ambiguo", () => {
    expect(detectarOrdenFecha(["03/10/2026", "05/11/2026"])).toEqual({
      orden: "dma",
      ambiguo: true,
    });
  });
  it("cada orden lee la fecha que toca", () => {
    expect(aFechaCon("03/10/26", "dma")).toBe("2026-10-03");
    expect(aFechaCon("10/03/2026", "mda")).toBe("2026-10-03");
    expect(aFechaCon("2026.10.03", "dma")).toBe("2026-10-03");
    expect(aFechaCon("31/02/2026", "dma")).toBeNull();
    expect(aFechaCon(new Date(Date.UTC(2026, 9, 3)), "dma")).toBe("2026-10-03");
  });
});

describe("decimal: coma o punto, mirando toda la columna", () => {
  it("con los dos, el último es el decimal", () => {
    expect(detectarDecimal(["1.234,56", "-12,00"])).toEqual({ decimal: ",", ambiguo: false });
    expect(detectarDecimal(["1,234.56", "-12.00"])).toEqual({ decimal: ".", ambiguo: false });
  });
  it("«1.234» solo no dice nada; con otro «45,20» en la columna, sí", () => {
    expect(detectarDecimal(["1.234"])).toEqual({ decimal: ",", ambiguo: true });
    expect(detectarDecimal(["1.234", "45,20"])).toEqual({ decimal: ",", ambiguo: false });
    expect(detectarDecimal(["1.234.567"])).toEqual({ decimal: ",", ambiguo: false });
  });
  it("números de Excel: no hace falta", () => {
    expect(detectarDecimal([1234.56, -12])).toEqual({ decimal: ",", ambiguo: false });
  });
  it("lee el importe con el decimal elegido, con su signo", () => {
    expect(aNumeroCon("-1.234,56", ",")).toBe(-1234.56);
    expect(aNumeroCon("1,234.56", ".")).toBe(1234.56);
    expect(aNumeroCon("1.234", ",")).toBe(1234);
    expect(aNumeroCon("1.234", ".")).toBe(1.234);
    expect(aNumeroCon("45,20 €", ",")).toBe(45.2);
    expect(aNumeroCon("", ",")).toBeNull();
  });
});

describe("CSV", () => {
  it("el separador se elige mirando todas las líneas", () => {
    expect(detectarSeparador("Fecha;Concepto;Importe\n01/10/2026;Pago, señal;-10,00")).toBe(";");
    expect(detectarSeparador("Date,Description,Amount\n2026-10-01,Fee,-10.00")).toBe(",");
    expect(detectarSeparador("Fecha\tImporte\n01/10/2026\t5,00")).toBe("\t");
  });

  it("un extracto de un banco español: cabecera abajo, debe/haber, saldo y lo más nuevo arriba", () => {
    const csv = [
      `Movimientos de la cuenta ${IBAN.join(" ")}`,
      "Titular;RONOCA DESARROLLOS S.L.",
      "",
      "F. Operación;Concepto;Debe;Haber;Saldo",
      "25/10/2026;TRANSF. CLIENTE ABC;;1.210,00;2.150,00",
      "20/10/2026;RECIBO ALQUILER NAVE;1.020,00;;940,00",
      "03/10/2026;SEUR ENVIOS;40,00;;1.960,00",
    ].join("\r\n");
    const e = leerExtractoTexto(new Uint8Array([...new TextEncoder().encode(csv)]));
    expect(e.formato).toMatchObject({
      tipo: "csv",
      codificacion: "UTF-8",
      separador: ";",
      orden_fecha: "dma",
      decimal: ",",
      ambiguo: [],
    });
    expect(e.movimientos.map((m) => m.importe)).toEqual([1210, -1020, -40]);
    // Lo más nuevo arriba: el inicial sale del último (1.960 + 40), el final del primero.
    expect(e).toMatchObject({
      saldo_inicial: 2000,
      saldo_final: 2150,
      desde: "2026-10-03",
      hasta: "2026-10-25",
    });
    expect(cuadreExtracto(e.saldo_inicial, e.saldo_final, e.movimientos)).toEqual({
      suma: 150,
      cuadra: true,
      diferencia: 0,
    });
  });

  it("con fechas ambiguas, se fuerza el orden elegido", () => {
    const filas = [
      ["Fecha", "Concepto", "Importe"],
      ["03/10/2026", "a", "10,00"],
      ["05/11/2026", "b", "5,00"],
    ];
    const auto = extractoDeFilas(filas, { tipo: "csv" });
    expect(auto.formato.ambiguo).toEqual(["orden_fecha"]);
    const elegido = extractoDeFilas(filas, { tipo: "csv" }, { orden_fecha: "mda" });
    expect(elegido.formato.ambiguo).toEqual([]);
    expect(elegido.movimientos[0].fecha).toBe("2026-03-10");
  });

  it("si los saldos no encadenan, no se adivinan", () => {
    const r = saldosDeMovimientos([
      { fecha: "2026-10-01", concepto: "", importe: 10, saldo: 110 },
      { fecha: "2026-10-02", concepto: "", importe: 10, saldo: 500 },
    ]);
    expect(r.saldo_inicial).toBeNull();
    expect(r.aviso).toContain("no encadenan");
  });

  it("sin columna de fecha e importe, se dice qué falta", () => {
    expect(() => extractoDeFilas([["Hola", "Adiós"]], { tipo: "csv" })).toThrow(/fecha/);
  });
});

/** Un registro de 80 posiciones, rellenando con espacios. */
const reg = (...trozos: string[]) => trozos.join("").padEnd(80, " ");
const imp = (n: number) => String(Math.round(Math.abs(n) * 100)).padStart(14, "0");

describe("Norma 43", () => {
  const n43 = [
    // 11: entidad, oficina, cuenta, desde, hasta, clave saldo (2 acreedor), saldo inicial
    reg(
      "11",
      "2100",
      "0418",
      "0200051332",
      "261001",
      "261031",
      "2",
      imp(2000),
      "978",
      "3",
      "RONOCA",
    ),
    // 22: libre, oficina, fecha op., fecha valor, conceptos, clave (1 debe), importe, doc, refs
    reg(
      "22",
      "    ",
      "0418",
      "261003",
      "261003",
      "02",
      "000",
      "1",
      imp(40),
      "0000000000",
      "SEUR        ",
      "ENVIOS OCT     ",
    ),
    reg("23", "01", "PORTES Y MENSAJERIA".padEnd(38), ""),
    reg(
      "22",
      "    ",
      "0418",
      "261025",
      "261025",
      "02",
      "000",
      "2",
      imp(1210),
      "0000000000",
      "CLIENTE ABC ",
      "FRA 2026-0012   ",
    ),
    // 33: entidad, oficina, cuenta, nº debe, total debe, nº haber, total haber, clave, saldo final
    reg(
      "33",
      "2100",
      "0418",
      "0200051332",
      "00001",
      imp(40),
      "00001",
      imp(1210),
      "2",
      imp(3170),
      "978",
    ),
    reg("88", "9".repeat(18), "000006"),
  ].join("\n");

  it("se reconoce", () => {
    expect(esNorma43(n43)).toBe(true);
    expect(esNorma43("Fecha;Importe\n01/10/2026;5")).toBe(false);
  });

  it("movimientos con su signo, concepto con los registros 23, y los saldos de la cabecera y el final", () => {
    const e = leerNorma43(n43);
    expect(e.movimientos).toEqual([
      {
        fecha: "2026-10-03",
        concepto: "SEUR ENVIOS OCT · PORTES Y MENSAJERIA",
        importe: -40,
        saldo: 1960,
      },
      { fecha: "2026-10-25", concepto: "CLIENTE ABC FRA 2026-0012", importe: 1210, saldo: 3170 },
    ]);
    expect(e).toMatchObject({
      saldo_inicial: 2000,
      saldo_final: 3170,
      desde: "2026-10-01",
      hasta: "2026-10-31",
    });
    expect(cuadreExtracto(e.saldo_inicial, e.saldo_final, e.movimientos).cuadra).toBe(true);
    expect(leerExtractoTexto(new TextEncoder().encode(n43)).formato.tipo).toBe("norma43");
  });
});

describe("cuadre, huella e IBAN", () => {
  it("un céntimo de diferencia no cuadra", () => {
    const m = [{ fecha: "2026-10-01", concepto: "", importe: 265.43, saldo: null }];
    expect(cuadreExtracto(1234.56, 1500, m)).toEqual({
      suma: 265.43,
      cuadra: false,
      diferencia: 0.01,
    });
    expect(cuadreExtracto(null, 1500, m).cuadra).toBe(false);
  });
  it("la huella depende de la cuenta: el mismo movimiento en otra cuenta es otro", () => {
    const m = { fecha: "2026-10-01", concepto: "Traspaso", importe: -100, saldo: 900 };
    expect(huellaMovimiento("a", m)).not.toBe(huellaMovimiento("b", m));
    expect(huellaMovimiento("a", m)).toBe(huellaMovimiento("a", { ...m, concepto: "TRASPASO " }));
  });
  it("IBAN: sin espacios, en mayúsculas y con su dígito de control", () => {
    expect(normalizarIban(IBAN.join(" ").toLowerCase())).toBe(IBAN.join(""));
    // Un dígito de control cambiado: no vale.
    expect(normalizarIban(["ES92", ...IBAN.slice(1)].join(""))).toBeNull();
    expect(normalizarIban("hola")).toBeNull();
  });
});
