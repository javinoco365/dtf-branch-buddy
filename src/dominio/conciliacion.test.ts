import { describe, expect, it } from "vitest";
import {
  contieneReferencia,
  emparejar,
  esSegura,
  mencionaCliente,
  normalizar,
  type FacturaPendiente,
  type MovimientoBanco,
} from "./conciliacion";

const factura = (p: Partial<FacturaPendiente> = {}): FacturaPendiente => ({
  id: "f1",
  referencia: "2026/0007",
  fecha: "2026-09-01",
  total: 302.5,
  cliente_nombre: "Javier Novoa Contreras",
  ...p,
});

const movimiento = (p: Partial<MovimientoBanco> = {}): MovimientoBanco => ({
  id: "m1",
  fecha: "2026-09-05",
  concepto: "TRANSFERENCIA",
  importe: 302.5,
  ...p,
});

describe("normalizar", () => {
  it("quita acentos, signos y mayúsculas", () => {
    expect(normalizar("TRANSF. J. NOVOA CONTRERAS")).toBe("transf j novoa contreras");
    expect(normalizar("Cía. Textil, S.L.")).toBe("cia textil s l");
  });
});

describe("contieneReferencia", () => {
  it("reconoce la referencia escrita de muchas maneras", () => {
    for (const c of [
      "TRANSF FRA 2026/0007",
      "PAGO 2026-0007",
      "factura 20260007 gracias",
      "FRA 2026 0007",
    ]) {
      expect(contieneReferencia(c, "2026/0007")).toBe(true);
    }
  });

  it("no la reconoce cuando no está", () => {
    expect(contieneReferencia("TRANSFERENCIA VARIOS", "2026/0007")).toBe(false);
    expect(contieneReferencia("FRA 2026/0008", "2026/0007")).toBe(false);
  });

  it("no caza con referencias demasiado cortas", () => {
    // Con pocos dígitos, cualquier número del concepto valdría.
    expect(contieneReferencia("recibo 12345 del mes", "12345")).toBe(false);
  });
});

describe("mencionaCliente", () => {
  it("reconoce al cliente aunque el banco recorte y quite tildes", () => {
    expect(mencionaCliente("TRANSF. J. NOVOA CONTRERAS", "Javier Novoa Contreras")).toBe(true);
  });

  it("exige dos palabras: un apellido suelto no identifica a nadie", () => {
    expect(mencionaCliente("TRANSFERENCIA NOVOA", "Javier Novoa Contreras")).toBe(false);
  });

  it("ignora la forma societaria, que no identifica", () => {
    expect(mencionaCliente("PAGO S L TEXTIL", "Otra Cosa S.L.")).toBe(false);
  });

  it("un cliente de una sola palabra casa con esa palabra", () => {
    expect(mencionaCliente("TRANSFERENCIA ZARA", "Zara")).toBe(true);
  });

  it("sin nombre de cliente no hay coincidencia", () => {
    expect(mencionaCliente("LO QUE SEA", null)).toBe(false);
  });
});

describe("emparejar", () => {
  it("casa por referencia aunque el importe cuadre con otras", () => {
    const facturas = [
      factura({ id: "a", referencia: "2026/0007" }),
      factura({ id: "b", referencia: "2026/0008", cliente_nombre: "Otro Cliente" }),
    ];
    const [p] = emparejar([movimiento({ concepto: "TRANSF FRA 2026/0008" })], facturas);
    expect(p.factura_id).toBe("b");
    expect(p.motivo).toBe("referencia");
    expect(esSegura(p)).toBe(true);
  });

  it("casa por cliente e importe cuando no viene la referencia", () => {
    const [p] = emparejar([movimiento({ concepto: "TRANSF J NOVOA CONTRERAS" })], [factura()]);
    expect(p.motivo).toBe("cliente_e_importe");
    expect(esSegura(p)).toBe(true);
  });

  it("perdona los dos céntimos de tolerancia", () => {
    const [p] = emparejar([movimiento({ importe: 302.52 })], [factura()]);
    expect(p).toBeDefined();
    expect(p.diferencia).toBe(0.02);
  });

  it("no casa fuera de la tolerancia", () => {
    expect(emparejar([movimiento({ importe: 302.55 })], [factura()])).toEqual([]);
  });

  it("por importe solo NO se aplica sola: es donde se cuela el error", () => {
    // Dos clientes distintos pagando lo mismo: elegir al azar deja una factura
    // marcada como cobrada que no lo está.
    const facturas = [
      factura({ id: "a", cliente_nombre: "Cliente Uno Uno" }),
      factura({ id: "b", cliente_nombre: "Cliente Dos Dos", fecha: "2026-08-20" }),
    ];
    const [p] = emparejar([movimiento({ concepto: "TRANSFERENCIA" })], facturas);
    expect(p.motivo).toBe("importe");
    expect(p.candidatas).toBe(2);
    expect(esSegura(p)).toBe(false);
  });

  it("una factura no se cobra dos veces", () => {
    const movimientos = [
      movimiento({ id: "m1", concepto: "TRANSFERENCIA" }),
      movimiento({ id: "m2", concepto: "TRANSFERENCIA" }),
    ];
    const propuestas = emparejar(movimientos, [factura()]);
    expect(propuestas).toHaveLength(1);
  });

  it("los cargos no pagan facturas", () => {
    expect(emparejar([movimiento({ importe: -302.5 })], [factura()])).toEqual([]);
  });

  it("no casa con una factura de hace dos años", () => {
    expect(emparejar([movimiento()], [factura({ fecha: "2024-01-01" })])).toEqual([]);
  });

  it("la referencia gana a otro movimiento que cuadraba por importe", () => {
    // m2 trae la referencia de la factura; si m1 se la lleva por importe,
    // el que la nombra se queda sin casar. Se resuelven antes las nombradas.
    const movimientos = [
      movimiento({ id: "m1", concepto: "TRANSFERENCIA SIN MAS" }),
      movimiento({ id: "m2", concepto: "PAGO FRA 2026/0007" }),
    ];
    const propuestas = emparejar(movimientos, [factura()]);
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].movimiento_id).toBe("m2");
  });
});
