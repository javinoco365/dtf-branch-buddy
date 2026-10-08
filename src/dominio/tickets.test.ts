import { describe, expect, it } from "vitest";
import {
  cabeEnTicket,
  clasificarParaTickets,
  decidirDocumento,
  documentoDelPedido,
  documentoVigente,
  esTipoFiscal,
  estaCobrado,
  etiquetaTipoFiscal,
  explicarDecision,
  LIMITES_TICKET,
  limiteTicket,
  situacionTicket,
  tieneDatosFiscales,
  type DecisionDocumento,
} from "./tickets";

const SIN_DATOS = { nombre: null, nif: null, tipo_fiscal: null };
const PARTICULAR = { nombre: "Vecina", nif: null, tipo_fiscal: "particular" as const };
const PROFESIONAL = { nombre: "Taller", nif: null, tipo_fiscal: "profesional" as const };
const CON_NIF = { nombre: "Talleres Pérez S.L.", nif: "B-12.345.678", tipo_fiscal: null };

describe("decidirDocumento: la tabla del RD 1619/2012 art. 4", () => {
  it("con nombre y NIF, factura completa sea cual sea el importe", () => {
    expect(decidirDocumento(12, CON_NIF)).toEqual({ documento: "factura" });
    expect(decidirDocumento(5000, CON_NIF)).toEqual({ documento: "factura" });
  });

  it("particular: ticket hasta 3000 €, datos por encima", () => {
    expect(decidirDocumento(3000, PARTICULAR)).toEqual({ documento: "ticket", limite: 3000 });
    expect(decidirDocumento(3000.01, PARTICULAR)).toEqual({
      documento: "pedir_datos",
      limite: 3000,
    });
  });

  it("profesional: ticket hasta 400 €, factura obligatoria por encima", () => {
    expect(decidirDocumento(400, PROFESIONAL)).toEqual({ documento: "ticket", limite: 400 });
    expect(decidirDocumento(484, PROFESIONAL)).toEqual({ documento: "pedir_datos", limite: 400 });
  });

  it("sin saber quién es: ticket hasta 400, pregunta hasta 3000, datos por encima", () => {
    expect(decidirDocumento(36.3, SIN_DATOS)).toEqual({ documento: "ticket", limite: 400 });
    expect(decidirDocumento(484, SIN_DATOS)).toEqual({
      documento: "preguntar_tipo",
      limite: 400,
      limite_particular: 3000,
    });
    expect(decidirDocumento(3025, SIN_DATOS)).toEqual({ documento: "pedir_datos", limite: 400 });
    expect(decidirDocumento(36.3, null)).toEqual({ documento: "ticket", limite: 400 });
  });

  it("sin importe no hay documento", () => {
    expect(decidirDocumento(0, SIN_DATOS)).toEqual({ documento: "sin_importe" });
    expect(decidirDocumento(-10, CON_NIF)).toEqual({ documento: "sin_importe" });
    expect(decidirDocumento(0.004, SIN_DATOS)).toEqual({ documento: "sin_importe" });
  });

  it("usa los límites de la empresa, no los de por defecto", () => {
    const limites = { general: 500, particular: 2000 };
    expect(decidirDocumento(450, SIN_DATOS, limites)).toEqual({ documento: "ticket", limite: 500 });
    expect(decidirDocumento(2500, PARTICULAR, limites)).toEqual({
      documento: "pedir_datos",
      limite: 2000,
    });
  });
});

describe("el límite exacto, en céntimos", () => {
  it("400,00 cabe; 400,01 no; la suma en coma flotante no engaña", () => {
    expect(cabeEnTicket(400, null)).toBe(true);
    expect(cabeEnTicket(400.01, null)).toBe(false);
    // 0.1 + 0.2 + 399.7 da 400.00000000000006 en coma flotante.
    expect(cabeEnTicket(0.1 + 0.2 + 399.7, null)).toBe(true);
  });

  it("sin indicar cuenta como profesional", () => {
    expect(limiteTicket(null)).toBe(LIMITES_TICKET.general);
    expect(limiteTicket("profesional")).toBe(400);
    expect(limiteTicket("particular")).toBe(3000);
  });
});

describe("datos fiscales", () => {
  it("hace falta nombre y NIF; el NIF con espacios o guiones cuenta", () => {
    expect(tieneDatosFiscales(CON_NIF)).toBe(true);
    expect(tieneDatosFiscales({ nombre: "Sin NIF", nif: "  " })).toBe(false);
    expect(tieneDatosFiscales({ nombre: " ", nif: "B12345678" })).toBe(false);
    expect(tieneDatosFiscales(null)).toBe(false);
  });

  it("tipo fiscal y etiquetas", () => {
    expect(esTipoFiscal("particular")).toBe(true);
    expect(esTipoFiscal("autonomo")).toBe(false);
    expect(etiquetaTipoFiscal(null)).toBe("Sin indicar");
    expect(etiquetaTipoFiscal("profesional")).toBe("Profesional o empresa");
  });

  it("cada decisión tiene su explicación", () => {
    const todas: DecisionDocumento[] = [
      { documento: "factura" },
      { documento: "ticket", limite: 400 },
      { documento: "pedir_datos", limite: 400 },
      { documento: "preguntar_tipo", limite: 400, limite_particular: 3000 },
      { documento: "sin_importe" },
    ];
    for (const d of todas) expect(explicarDecision(d)).not.toBe("");
  });
});

describe("documentoVigente", () => {
  const doc = (
    id: string,
    tipo: "ordinaria" | "rectificativa" | "simplificada",
    extra: Partial<{ estado: string; rectifica_a_id: string }> = {},
  ) => ({
    id,
    tipo,
    estado: extra.estado ?? "emitida",
    rectifica_a_id: extra.rectifica_a_id ?? null,
  });

  it("el ticket o la factura del pedido, si no están rectificados", () => {
    expect(documentoVigente([doc("t1", "simplificada")])?.id).toBe("t1");
    expect(documentoVigente([])).toBeNull();
  });

  it("rectificado, deja de contar; y el nuevo cuenta", () => {
    const docs = [
      doc("t1", "simplificada"),
      doc("r1", "rectificativa", { rectifica_a_id: "t1" }),
      doc("t2", "simplificada"),
    ];
    expect(documentoVigente(docs)?.id).toBe("t2");
    expect(documentoVigente([doc("t1", "simplificada")], ["t1"])).toBeNull();
  });

  it("borradores y anuladas no cuentan", () => {
    expect(documentoVigente([doc("b", "ordinaria", { estado: "borrador" })])).toBeNull();
    expect(documentoVigente([doc("a", "ordinaria", { estado: "anulada" })])).toBeNull();
  });
});

describe("estaCobrado", () => {
  it("cobrado entero al céntimo, y sin importe nunca", () => {
    expect(estaCobrado(36.3, 36.3)).toBe(true);
    expect(estaCobrado(36.3, 36.29)).toBe(false);
    expect(estaCobrado(36.3, 40)).toBe(true);
    expect(estaCobrado(0, 0)).toBe(false);
  });
});

describe("clasificarParaTickets", () => {
  const p = (
    id: string,
    total: number,
    cliente: Parameters<typeof decidirDocumento>[1] = null,
  ) => ({
    id,
    numero: id,
    total,
    cliente,
  });

  it("en bloque solo lo que no admite duda", () => {
    const r = clasificarParaTickets([
      p("a", 36.3),
      p("b", 484),
      p("c", 60, CON_NIF),
      p("d", 900, PARTICULAR),
      p("e", 500, PROFESIONAL),
      p("f", 0),
    ]);
    expect(r.tickets.map((x) => x.id)).toEqual(["a", "d"]);
    expect(r.facturas.map((x) => x.id)).toEqual(["c"]);
    expect(r.revisar.map((x) => [x.pedido.id, x.decision.documento])).toEqual([
      ["b", "preguntar_tipo"],
      ["e", "pedir_datos"],
    ]);
  });
});

describe("situacionTicket", () => {
  const doc = (
    id: string,
    extra: Partial<{ rectifica_a_id: string; sustituye_a_id: string }> = {},
  ) => ({
    id,
    referencia: id.toUpperCase(),
    rectifica_a_id: extra.rectifica_a_id ?? null,
    sustituye_a_id: extra.sustituye_a_id ?? null,
  });

  it("intacto: se puede canjear o anular", () => {
    expect(situacionTicket("t1", [doc("t1"), doc("f9")])).toEqual({
      canjeado_por: null,
      rectificado_por: null,
      admite_cambios: true,
    });
  });

  it("canjeado o rectificado: ya no", () => {
    expect(situacionTicket("t1", [doc("t1"), doc("f1", { sustituye_a_id: "t1" })])).toEqual({
      canjeado_por: "F1",
      rectificado_por: null,
      admite_cambios: false,
    });
    expect(situacionTicket("t1", [doc("r1", { rectifica_a_id: "t1" })]).rectificado_por).toBe("R1");
    expect(situacionTicket("t1", [doc("r1", { rectifica_a_id: "t1" })]).admite_cambios).toBe(false);
  });
});

describe("documentoDelPedido", () => {
  const doc = (
    id: string,
    tipo: "ordinaria" | "rectificativa" | "simplificada",
    extra: Partial<{ estado: string; rectifica_a_id: string; sustituye_a_id: string }> = {},
  ) => ({
    id,
    tipo,
    estado: extra.estado ?? "emitida",
    rectifica_a_id: extra.rectifica_a_id ?? null,
    sustituye_a_id: extra.sustituye_a_id ?? null,
  });

  it("el ticket o la factura del pedido", () => {
    expect(documentoDelPedido([doc("t1", "simplificada")])?.id).toBe("t1");
    expect(documentoDelPedido([])).toBeNull();
  });

  it("en un canje, la factura, venga antes o después del ticket", () => {
    const t = doc("t1", "simplificada");
    const f = doc("f1", "ordinaria", { sustituye_a_id: "t1" });
    expect(documentoDelPedido([t, f])?.id).toBe("f1");
    expect(documentoDelPedido([f, t])?.id).toBe("f1");
  });

  it("si se anula la factura del canje, vuelve a contar el ticket", () => {
    const docs = [
      doc("t1", "simplificada"),
      doc("f1", "ordinaria", { sustituye_a_id: "t1", estado: "anulada" }),
      doc("r1", "rectificativa", { rectifica_a_id: "f1" }),
    ];
    expect(documentoDelPedido(docs)?.id).toBe("t1");
    // Rectificada sin cambiarle el estado: igual.
    expect(
      documentoDelPedido([
        doc("t1", "simplificada"),
        doc("f1", "ordinaria", { sustituye_a_id: "t1" }),
        doc("r1", "rectificativa", { rectifica_a_id: "f1" }),
      ])?.id,
    ).toBe("t1");
  });

  it("anulado del todo, ninguno", () => {
    expect(
      documentoDelPedido([
        doc("t1", "simplificada", { estado: "anulada" }),
        doc("r1", "rectificativa", { rectifica_a_id: "t1" }),
      ]),
    ).toBeNull();
    expect(documentoDelPedido([doc("t1", "simplificada")], ["t1"])).toBeNull();
  });
});
