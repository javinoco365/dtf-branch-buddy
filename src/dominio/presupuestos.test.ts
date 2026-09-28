import { describe, expect, it } from "vitest";
import {
  FILTRO_PRESUPUESTOS_TODO,
  ambitoPresupuesto,
  estadoVisible,
  filtrarPresupuestos,
  normalizarPrefijo,
  prefijoDeTienda,
  prefijoValido,
  referenciaPresupuesto,
  totalesPresupuesto,
  validoHasta,
} from "./presupuestos";

describe("numeración", () => {
  it("la referencia lleva el prefijo de la tienda y cuatro cifras", () => {
    expect(referenciaPresupuesto("DTFC", 2026, 7)).toBe("PRES-DTFC-2026-0007");
  });

  it("un contador por tienda", () => {
    expect(ambitoPresupuesto("abc")).toBe("presupuesto:abc");
  });
});

describe("prefijos", () => {
  it("normaliza a mayúsculas sin tildes ni símbolos, hasta 8", () => {
    expect(normalizarPrefijo("dtf-cúlture pro 2026")).toBe("DTFCULTU");
  });

  it("valida lo mismo que la base", () => {
    expect(prefijoValido("DTFC")).toBe(true);
    expect(prefijoValido("dt-f")).toBe(false);
    expect(prefijoValido("")).toBe(false);
  });

  it("usa el de la tienda; si no tiene, lo deduce como la migración", () => {
    expect(prefijoDeTienda({ prefijo: "PRO", slug: "dtf-culture" })).toBe("PRO");
    expect(prefijoDeTienda({ prefijo: null, slug: "dtf-culture", nombre: "X" })).toBe("DTFC");
    expect(prefijoDeTienda({ slug: null, nombre: "¡¡!!" })).toBe("TDA");
  });
});

describe("caducidad", () => {
  it("válido hasta fecha + días, cruzando de mes", () => {
    expect(validoHasta("2026-09-20", 30)).toBe("2026-10-20");
  });

  const p = { fecha: "2026-09-01", validez_dias: 10 };
  it("un enviado cuyo plazo pasó se ve caducado", () => {
    expect(estadoVisible({ ...p, estado: "enviado" }, new Date(2026, 8, 12))).toBe("caducado");
  });

  it("el último día todavía vale", () => {
    expect(estadoVisible({ ...p, estado: "borrador" }, new Date(2026, 8, 11))).toBe("borrador");
  });

  it("aceptado y rechazado no caducan", () => {
    expect(estadoVisible({ ...p, estado: "aceptado" }, new Date(2027, 0, 1))).toBe("aceptado");
  });
});

describe("totalesPresupuesto", () => {
  const metros = {
    descripcion: "Metro DTF",
    cantidad: 5,
    unidad: "m",
    precio_unitario: 12,
    iva_rate: 21,
  };

  it("líneas congeladas con su base, cuota y total", () => {
    const t = totalesPresupuesto([metros], 0);
    expect(t.lineas[0]).toMatchObject({ subtotal: 60, iva: 12.6, total: 72.6 });
    expect(t).toMatchObject({ subtotal: 60, iva: 12.6, envio: 0, total: 72.6 });
  });

  it("el envío entra en la base y tributa al 21 %", () => {
    expect(totalesPresupuesto([metros], 10)).toMatchObject({
      subtotal: 70,
      iva: 14.7,
      envio: 10,
      total: 84.7,
    });
  });

  it("sin IVA en las líneas, el envío tampoco lo lleva", () => {
    expect(totalesPresupuesto([{ ...metros, iva_rate: 0 }], 10)).toMatchObject({
      subtotal: 70,
      iva: 0,
      total: 70,
    });
  });
});

describe("filtrarPresupuestos", () => {
  const hoy = new Date(2026, 8, 28);
  const lista = [
    {
      numero: "PRES-DTFC-2026-0001",
      cliente_nombre: "Peña La Charanga",
      estado: "enviado" as const,
      fecha: "2026-09-25",
      validez_dias: 30,
    },
    {
      numero: "PRES-DTFC-2026-0002",
      cliente_nombre: "Club Náutico",
      estado: "enviado" as const,
      fecha: "2026-08-01",
      validez_dias: 10,
    },
    {
      numero: "PRES-DTFC-2026-0003",
      cliente_nombre: "Talleres",
      estado: "aceptado" as const,
      fecha: "2026-09-01",
      validez_dias: 30,
    },
  ];

  it("sin filtro, todos", () => {
    expect(filtrarPresupuestos(lista, FILTRO_PRESUPUESTOS_TODO, hoy)).toHaveLength(3);
  });

  it("por estado visible: el caducado aparte del enviado", () => {
    const f = (estado: typeof FILTRO_PRESUPUESTOS_TODO.estado) =>
      filtrarPresupuestos(lista, { texto: "", estado }, hoy).map((p) => p.numero.slice(-1));
    expect(f("enviado")).toEqual(["1"]);
    expect(f("caducado")).toEqual(["2"]);
  });

  it("por texto, sin tildes, en cliente o número", () => {
    const f = (texto: string) =>
      filtrarPresupuestos(lista, { texto, estado: "todos" }, hoy).map((p) => p.numero.slice(-1));
    expect(f("nautico")).toEqual(["2"]);
    expect(f("0003")).toEqual(["3"]);
  });
});
