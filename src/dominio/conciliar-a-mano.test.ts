import { describe, expect, it } from "vitest";
import {
  coincideConPalabras,
  cumpleBusqueda,
  filtrarMovimientos,
  interpretarBusqueda,
  ordenarCandidatos,
  palabrasDeBusqueda,
  patronIlike,
  pendienteDeEnlace,
  resumenSeleccion,
  SIN_FILTRO,
  sentidoDe,
  totalesPorSentido,
  type DocumentoBuscado,
} from "./conciliar-a-mano";

const doc = (p: Partial<DocumentoBuscado> = {}): DocumentoBuscado => ({
  tipo: "factura",
  id: "d1",
  fecha: "2026-09-01",
  esperado: 100,
  contraparte: "Talleres García S.L.",
  nif: "B12345678",
  referencia: "T2026/0057",
  ...p,
});

const mov = (importe: number, concepto = "", cuenta_id: string | null = "c1") => ({
  id: `m${importe}`,
  fecha: "2026-09-05",
  concepto,
  importe,
  cuenta_id,
});

describe("sentidoDe", () => {
  it("lo que entra es un cobro y lo que sale, un pago", () => {
    expect(sentidoDe(10)).toBe("cobro");
    expect(sentidoDe(-10)).toBe("pago");
  });
});

describe("búsqueda", () => {
  it("separa las palabras sin acentos ni repetidas", () => {
    expect(palabrasDeBusqueda("García  garcia, Pérez")).toEqual(["garcia", "perez"]);
  });

  it("el patrón de la base encuentra la palabra con acentos y eñes", () => {
    expect(patronIlike("garcia")).toBe("g_rc__");
    expect(patronIlike("pena")).toBe("p___");
  });

  it("todas las palabras tienen que estar, en cualquier orden y sin acentos", () => {
    expect(coincideConPalabras(doc(), ["garcia", "talleres"])).toBe(true);
    expect(coincideConPalabras(doc(), ["garcia", "lopez"])).toBe(false);
  });

  it("encuentra por NIF y por número de factura", () => {
    expect(coincideConPalabras(doc(), ["b12345678"])).toBe(true);
    expect(coincideConPalabras(doc(), ["t20260057"])).toBe(true);
  });

  it("un importe encuentra lo que está a un euro o menos, también lo que le queda", () => {
    const b = interpretarBusqueda("100,80");
    expect(cumpleBusqueda(doc(), b)).toBe(true);
    expect(cumpleBusqueda(doc({ esperado: 102 }), b)).toBe(false);
    const parcial = doc({ esperado: 300, parcial: { grupo: "g", pagado: 200, pendiente: 100 } });
    expect(cumpleBusqueda(parcial, b)).toBe(true);
  });

  it("un entero vale como importe o como número de factura", () => {
    const b = interpretarBusqueda("57");
    expect(cumpleBusqueda(doc({ esperado: 999 }), b)).toBe(true);
    expect(cumpleBusqueda(doc({ esperado: 57.4, referencia: "2026/0001" }), b)).toBe(true);
    expect(cumpleBusqueda(doc({ esperado: 999, referencia: "2026/0001" }), b)).toBe(false);
  });
});

describe("pendienteDeEnlace", () => {
  it("un cobro corto deja pendiente lo que falta", () => {
    // Factura de 300, cobrados 200: diferencia banco − factura = −100.
    expect(pendienteDeEnlace(300, -100)).toBe(100);
  });

  it("un pago corto de una recibida, igual con signo de cargo", () => {
    expect(pendienteDeEnlace(-300, 100)).toBe(-100);
  });

  it("si cuadra o sobra, no queda nada", () => {
    expect(pendienteDeEnlace(300, 0)).toBeNull();
    expect(pendienteDeEnlace(300, 5)).toBeNull();
  });
});

describe("ordenarCandidatos", () => {
  it("primero lo que casa al céntimo, luego lo más cercano en importe y en fecha", () => {
    const docs = [
      doc({ id: "lejos", esperado: 150 }),
      doc({ id: "cerca", esperado: 101 }),
      doc({ id: "exacta-vieja", esperado: 100, fecha: "2026-06-01" }),
      doc({ id: "exacta", esperado: 100, fecha: "2026-09-04" }),
    ];
    const r = ordenarCandidatos(docs, { importe: 100, fecha: "2026-09-05" });
    expect(r.map((d) => d.id)).toEqual(["exacta", "exacta-vieja", "cerca", "lejos"]);
  });

  it("una cobrada en parte se ordena por lo que le queda", () => {
    const docs = [
      doc({ id: "otra", esperado: 145 }),
      doc({ id: "parcial", esperado: 300, parcial: { grupo: "g", pagado: 160, pendiente: 140 } }),
    ];
    const r = ordenarCandidatos(docs, { importe: 140, fecha: "2026-09-05" });
    expect(r.map((d) => d.id)).toEqual(["parcial", "otra"]);
  });

  it("sin movimiento, lo más reciente primero", () => {
    const r = ordenarCandidatos(
      [doc({ id: "a", fecha: "2026-01-01" }), doc({ id: "b", fecha: "2026-05-01" })],
      null,
    );
    expect(r.map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("resumenSeleccion", () => {
  it("un movimiento que paga dos facturas: suma y cuadra", () => {
    const r = resumenSeleccion(
      [{ importe: 250 }],
      [doc({ id: "a", esperado: 100 }), doc({ id: "b", esperado: 150 })],
    );
    expect(r.error).toBeNull();
    expect(r.diferencia).toBe(0);
  });

  it("dos movimientos que pagan una factura", () => {
    const r = resumenSeleccion([{ importe: 60 }, { importe: 40 }], [doc()]);
    expect(r.error).toBeNull();
    expect(r.sumaMovimientos).toBe(100);
  });

  it("no deja varios contra varios, ni mezclar cobros y pagos", () => {
    expect(
      resumenSeleccion([{ importe: 1 }, { importe: 2 }], [doc({ id: "a" }), doc({ id: "b" })])
        .error,
    ).toMatch(/por partes/);
    expect(resumenSeleccion([{ importe: 1 }, { importe: -2 }], [doc()]).error).toMatch(
      /cobros y pagos/,
    );
  });

  it("un cobro no paga una recibida", () => {
    const r = resumenSeleccion([{ importe: 100 }], [doc({ tipo: "compra", esperado: -100 })]);
    expect(r.error).toMatch(/emitidos/);
  });

  it("añadir un pago a una cobrada en parte: dice qué enlace amplía", () => {
    const parcial = doc({ esperado: 300, parcial: { grupo: "g1", pagado: 200, pendiente: 100 } });
    const r = resumenSeleccion([{ importe: 100 }], [parcial]);
    expect(r.error).toBeNull();
    expect(r.ampliaGrupo).toBe("g1");
    expect(r.diferencia).toBe(0);
    expect(resumenSeleccion([{ importe: 100 }], [parcial, doc({ id: "x" })]).error).toMatch(/sola/);
  });

  it("sin nada marcado lo dice", () => {
    expect(resumenSeleccion([], []).error).toMatch(/movimiento/);
    expect(resumenSeleccion([{ importe: 1 }], []).error).toMatch(/factura/);
  });
});

describe("filtrarMovimientos y totales", () => {
  const movs = [mov(100, "TPV REMESA"), mov(-40.48, "RECIBO LUZ", "c2"), mov(25, "BIZUM ANA")];

  it("cobros, pagos, cuenta y texto", () => {
    expect(filtrarMovimientos(movs, { ...SIN_FILTRO, sentido: "pago" })).toHaveLength(1);
    expect(filtrarMovimientos(movs, { ...SIN_FILTRO, sentido: "cobro" })).toHaveLength(2);
    expect(filtrarMovimientos(movs, { ...SIN_FILTRO, cuenta: "c2" })).toHaveLength(1);
    expect(filtrarMovimientos(movs, { ...SIN_FILTRO, texto: "bizum" })).toHaveLength(1);
    expect(filtrarMovimientos(movs, { ...SIN_FILTRO, texto: "40,48" })).toHaveLength(1);
  });

  it("cuenta y suma cobros y pagos por separado", () => {
    expect(totalesPorSentido(movs)).toEqual({
      cobro: { n: 2, total: 125 },
      pago: { n: 1, total: -40.48 },
    });
  });
});
