import { describe, expect, it } from "vitest";
import { apuntesDeVenta, type DocumentoConFecha } from "./canjes";

const doc = (id: string, fecha: string, extra: Partial<DocumentoConFecha> = {}) => ({
  id,
  fecha,
  estado: "emitida",
  sustituye_a_id: null,
  rectifica_a_id: null,
  ...extra,
});

// Lo que apunta cada documento, en corto: [quién apunta, de quién son los importes, signo].
const resumen = (docs: DocumentoConFecha[], referencias: DocumentoConFecha[] = []) =>
  apuntesDeVenta(docs, referencias).map((a) => [a.documento.id, a.importes.id, a.signo, a.motivo]);

describe("apuntes de venta con canjes de ticket por factura", () => {
  const t = doc("T", "2026-02-10");
  const f = doc("F", "2026-02-10", { sustituye_a_id: "T" });
  const r = doc("R", "2026-04-02", { rectifica_a_id: "F" });

  it("cada documento emitido apunta lo suyo; la factura del canje resta el ticket", () => {
    expect(resumen([t, f])).toEqual([
      ["T", "T", 1, "documento"],
      ["F", "F", 1, "documento"],
      ["F", "T", -1, "canje"],
    ]);
  });

  it("la rectificativa que anula la factura del canje devuelve el ticket, en su fecha", () => {
    expect(resumen([r], [t, f])).toEqual([
      ["R", "R", 1, "documento"],
      ["R", "T", 1, "canje_anulado"],
    ]);
  });

  it("lo de referencias solo se mira: no apunta nada", () => {
    // La factura del canje en el periodo; el ticket, de otro.
    expect(resumen([f], [t])).toEqual([
      ["F", "F", 1, "documento"],
      ["F", "T", -1, "canje"],
    ]);
  });

  it("si no se conoce el ticket, no hay qué restar", () => {
    expect(resumen([f])).toEqual([["F", "F", 1, "documento"]]);
  });

  it("los borradores no apuntan ni canjean", () => {
    expect(resumen([t, { ...f, estado: "borrador" }])).toEqual([["T", "T", 1, "documento"]]);
    // Una rectificativa en borrador no devuelve el ticket.
    expect(resumen([{ ...r, estado: "borrador" }], [t, f])).toEqual([]);
  });

  it("una factura con estado «anulada» cuenta lo suyo, así que también resta su ticket", () => {
    expect(resumen([t, { ...f, estado: "anulada" }])).toEqual([
      ["T", "T", 1, "documento"],
      ["F", "F", 1, "documento"],
      ["F", "T", -1, "canje"],
    ]);
  });

  it("la rectificativa de una factura que no es de canje solo apunta lo suyo", () => {
    const g = doc("G", "2026-01-05");
    expect(resumen([doc("RG", "2026-03-01", { rectifica_a_id: "G" })], [g])).toEqual([
      ["RG", "RG", 1, "documento"],
    ]);
  });

  it("con dos rectificativas de la misma factura de canje, el ticket vuelve una vez", () => {
    const r2 = doc("R2", "2026-05-01", { rectifica_a_id: "F" });
    expect(resumen([r, r2], [t, f])).toEqual([
      ["R", "R", 1, "documento"],
      ["R", "T", 1, "canje_anulado"],
      ["R2", "R2", 1, "documento"],
    ]);
    // Aunque la primera sea de otro periodo y solo se conozca como referencia.
    expect(resumen([r2], [t, f, r])).toEqual([["R2", "R2", 1, "documento"]]);
  });
});
