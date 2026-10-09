import { describe, expect, it } from "vitest";
import type { DocArchivo } from "./archivo";
import {
  totalesArchivo,
  totalesCola,
  totalesCompras,
  totalesPresupuestos,
} from "./sumatorios-facturas";

describe("totalesPresupuestos", () => {
  const hoy = new Date(2026, 9, 8);
  const presupuesto = (
    estado: "borrador" | "enviado" | "aceptado" | "rechazado",
    total: number,
  ) => ({
    estado,
    fecha: "2026-10-01",
    validez_dias: 30,
    total,
  });

  it("los rechazados no suman y se cuentan aparte", () => {
    expect(
      totalesPresupuestos(
        [presupuesto("aceptado", 100), presupuesto("enviado", 50.5), presupuesto("rechazado", 80)],
        hoy,
      ),
    ).toEqual({ presupuestos: 2, total: 150.5, rechazados: 1, caducados: 0 });
  });

  it("uno enviado fuera de plazo se ve caducado y no suma", () => {
    const t = totalesPresupuestos(
      [
        { estado: "enviado", fecha: "2026-08-01", validez_dias: 15, total: 200 },
        { estado: "borrador", fecha: "2026-10-01", validez_dias: 15, total: 30 },
      ],
      hoy,
    );
    expect(t).toEqual({ presupuestos: 1, total: 30, rechazados: 0, caducados: 1 });
  });

  it("un aceptado antiguo no caduca: ya tiene respuesta", () => {
    const t = totalesPresupuestos(
      [{ estado: "aceptado", fecha: "2025-01-01", validez_dias: 15, total: "99.99" }],
      hoy,
    );
    expect(t).toMatchObject({ presupuestos: 1, total: 99.99, caducados: 0 });
  });

  it("sin presupuestos, cero", () => {
    expect(totalesPresupuestos([], hoy)).toEqual({
      presupuestos: 0,
      total: 0,
      rechazados: 0,
      caducados: 0,
    });
  });
});

describe("totalesCompras", () => {
  it("los borradores no suman; el importe es el líquido, o el total si no lo hay", () => {
    expect(
      totalesCompras([
        { estado: "registrada", base: 100, liquido: 106, total: 121 },
        { estado: "registrada", base: "10.10", liquido: null, total: "12.22" },
        { estado: "borrador", base: 500, liquido: 605, total: 605 },
      ]),
    ).toEqual({ facturas: 2, base: 110.1, liquido: 118.22, borradores: 1 });
  });
});

describe("totalesCola", () => {
  it("las que no se pudieron leer no tienen importe: se cuentan aparte", () => {
    expect(
      totalesCola([
        { revision: "pendiente", total: 121 },
        { revision: "pendiente", total: "0.1" },
        { revision: "error", total: 999 },
        { revision: "pendiente", total: null },
      ]),
    ).toEqual({ leidas: 3, total: 121.1, sinLeer: 1 });
  });
});

describe("totalesArchivo", () => {
  const doc = (d: Partial<DocArchivo> & Pick<DocArchivo, "id" | "clase">): DocArchivo => ({
    origen: d.clase === "compra" ? "compra" : "tienda",
    fecha: "2026-10-01",
    referencia: "",
    tercero: null,
    nif: null,
    procedencia: null,
    base: 0,
    iva: 0,
    total: 0,
    estado: d.clase === "compra" ? "registrada" : "emitida",
    ext: "pdf",
    tieneFichero: true,
    ...d,
  });

  it("ventas y compras por separado; las rectificativas restan", () => {
    const t = totalesArchivo([
      doc({ id: "f1", clase: "emitida", base: 100, iva: 21, total: 121, estado: "anulada" }),
      doc({ id: "r1", clase: "rectificativa", base: -100, iva: -21, total: -121 }),
      doc({ id: "t1", clase: "ticket", base: 10, iva: 2.1, total: 12.1 }),
      doc({ id: "c1", clase: "compra", base: 50, iva: 10.5, total: 53 }),
      doc({ id: "c2", clase: "compra", base: 20, iva: 4.2, total: 24.2 }),
    ]);
    expect(t.ventas).toMatchObject({ documentos: 3, base: 10, iva: 2.1, total: 12.1 });
    expect(t.compras).toEqual({ documentos: 2, total: 77.2 });
  });

  it("un ticket canjeado por una factura del archivo no suma dos veces", () => {
    const t = totalesArchivo([
      doc({ id: "t1", clase: "ticket", base: 100, iva: 21, total: 121 }),
      doc({ id: "f1", clase: "emitida", base: 100, iva: 21, total: 121, sustituye_a_id: "t1" }),
    ]);
    expect(t.ventas).toMatchObject({ documentos: 1, total: 121, canjeados: 1 });
  });

  it("sin documentos, ceros", () => {
    const t = totalesArchivo([]);
    expect(t.ventas.documentos).toBe(0);
    expect(t.compras).toEqual({ documentos: 0, total: 0 });
  });
});
