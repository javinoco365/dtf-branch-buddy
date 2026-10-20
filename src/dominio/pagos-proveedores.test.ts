import { describe, expect, it } from "vitest";
import {
  anticiposProveedores,
  pagosPendientesProveedores,
  type CompraPendiente,
} from "./pagos-proveedores";
import type { ProformaFila } from "./proformas";

const compra = (id: string, extra: Partial<CompraPendiente> = {}): CompraPendiente => ({
  id,
  proveedor: "Textiles Sur S.L.",
  nif_proveedor: "B12345678",
  proveedor_id: null,
  numero: `F-${id}`,
  fecha: "2026-10-01",
  liquido: null,
  total: 121,
  estado: "registrada",
  estado_pago: "pendiente",
  borrada_en: null,
  ...extra,
});

// Mediodía en Madrid: el día es el 19 de octubre se mire como se mire.
const HOY = new Date("2026-10-19T10:00:00Z");
const haceDias = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 19 - n));
  return d.toISOString().slice(0, 10);
};

describe("pagosPendientesProveedores", () => {
  it("filtra borradores, borradas y pagadas", () => {
    const r = pagosPendientesProveedores(
      [
        compra("ok"),
        compra("borrador", { estado: "borrador" }),
        compra("borrada", { borrada_en: "2026-10-02T00:00:00Z" }),
        compra("pagada", { estado_pago: "pagada" }),
        compra("sin-estado", { estado_pago: null }),
      ],
      HOY,
    );
    expect(r.facturas).toBe(1);
    expect(r.total).toBe(121);
  });

  it("agrupa dos NIF escritos distinto en el mismo proveedor", () => {
    const r = pagosPendientesProveedores(
      [
        compra("a", { nif_proveedor: "ES-B12.345.678", fecha: "2026-09-10", total: "100.10" }),
        compra("b", { nif_proveedor: "b-12345678", proveedor: "TEXTILES SUR", total: 50 }),
        compra("c", { nif_proveedor: null, proveedor: "Gorras Norte", total: 10 }),
        compra("d", { nif_proveedor: "", proveedor: "gorras-norte", total: 5 }),
        compra("e", { proveedor_id: "prov-1", nif_proveedor: null, proveedor: "Con id", total: 1 }),
      ],
      HOY,
    );
    expect(r.porProveedor).toEqual([
      {
        clave: "n:B12345678",
        nombre: "Textiles Sur S.L.",
        facturas: 2,
        importe: 150.1,
        masAntigua: "2026-09-10",
      },
      {
        clave: "t:gorrasnorte",
        nombre: "Gorras Norte",
        facturas: 2,
        importe: 15,
        masAntigua: "2026-10-01",
      },
      { clave: "p:prov-1", nombre: "Con id", facturas: 1, importe: 1, masAntigua: "2026-10-01" },
    ]);
    expect(r.total).toBe(166.1);
    expect(r.facturas).toBe(5);
  });

  it("tramos en los bordes: 30, 31, 60, 61, 90 y 91 días", () => {
    const r = pagosPendientesProveedores(
      [30, 31, 60, 61, 90, 91, 0].map((n) => compra(`d${n}`, { fecha: haceDias(n), total: n })),
      HOY,
    );
    expect(r.tramos.map((t) => [t.clave, t.facturas, t.importe])).toEqual([
      ["0-30", 2, 30],
      ["31-60", 2, 91],
      ["61-90", 2, 151],
      ["90+", 1, 91],
    ]);
    expect(r.tramos.map((t) => t.etiqueta)).toEqual([
      "Hasta 30 días",
      "De 31 a 60 días",
      "De 61 a 90 días",
      "Más de 90 días",
    ]);
  });

  it("el líquido manda; si es nulo, el total", () => {
    const r = pagosPendientesProveedores(
      [
        compra("a", { liquido: "85.00", total: 100 }),
        compra("b", { liquido: null, total: "121.00" }),
      ],
      HOY,
    );
    expect(r.total).toBe(206);
  });

  it("lista vacía → ceros y los cuatro tramos vacíos", () => {
    const r = pagosPendientesProveedores([], HOY);
    expect(r).toMatchObject({ total: 0, facturas: 0, porProveedor: [] });
    expect(r.tramos.map((t) => [t.facturas, t.importe])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it("sin nombre ni NIF, «Sin proveedor»", () => {
    const r = pagosPendientesProveedores(
      [compra("a", { proveedor: null, nif_proveedor: null })],
      HOY,
    );
    expect(r.porProveedor[0]).toMatchObject({ clave: "t:", nombre: "Sin proveedor" });
  });
});

describe("proformas en los pagos", () => {
  it("la proforma casada no cuenta (cuenta su factura); la que no lo está sí, y se cuenta", () => {
    const r = pagosPendientesProveedores(
      [
        compra("f"),
        compra("casada", { tipo_documento: "proforma", casada: true }),
        compra("suelta", { tipo_documento: "proforma", total: 50 }),
      ],
      HOY,
    );
    expect(r.facturas).toBe(2);
    expect(r.proformas).toBe(1);
    expect(r.total).toBe(171);
  });

  const pf = (id: string, extra: Partial<ProformaFila> = {}): ProformaFila => ({
    id,
    tipo_documento: "proforma",
    estado: "registrada",
    proveedor: "Textiles Sur S.L.",
    nif_proveedor: "B12345678",
    numero: `P-${id}`,
    fecha: "2026-10-01",
    base: 100,
    total: 121,
    liquido: null,
    estado_pago: "pagada",
    fecha_pago: "2026-10-03",
    ...extra,
  });

  it("anticiposProveedores: proformas pagadas, registradas, sin borrar y sin factura", () => {
    const r = anticiposProveedores(
      [
        pf("a", { liquido: 100 }),
        pf("b", { fecha_pago: "2026-09-20", nif_proveedor: "ES-B12345678" }),
        pf("pendiente", { estado_pago: "pendiente" }),
        pf("borrador", { estado: "borrador" }),
        pf("borrada", { borrada_en: "2026-10-05" }),
        pf("casada"),
        pf("fac", { tipo_documento: "factura", proforma_id: "casada" }),
        pf("sin-estado", {
          estado: undefined,
          nif_proveedor: null,
          proveedor: "Otro",
          total: null,
        }),
        pf("factura-pagada", { tipo_documento: "factura" }),
      ],
      HOY,
    );
    expect(r.proformas).toBe(3);
    expect(r.total).toBe(221);
    expect(r.masAntigua).toBe("2026-09-20");
    expect(r.porProveedor.map((p) => [p.nombre, p.facturas, p.importe, p.masAntigua])).toEqual([
      ["Textiles Sur S.L.", 2, 221, "2026-09-20"],
      ["Otro", 1, 0, "2026-10-03"],
    ]);
  });

  it("sin anticipos, a cero", () => {
    expect(anticiposProveedores([], HOY)).toEqual({
      total: 0,
      proformas: 0,
      porProveedor: [],
      masAntigua: null,
    });
  });
});
