import { describe, expect, it } from "vitest";
import {
  DESCRIPCION_ENVIO,
  FILTRO_PRESUPUESTOS_TODO,
  ambitoPresupuesto,
  documentoPresupuesto,
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

describe("documentoPresupuesto", () => {
  // Lo que guarda guardarPresupuesto: las líneas con su base y la cabecera con
  // los totales de totalesPresupuesto.
  const guardado = (lineas: Parameters<typeof totalesPresupuesto>[0], envio = 0) => {
    const t = totalesPresupuesto(lineas, envio);
    return {
      fecha: "2026-10-16",
      validez_dias: 30,
      envio: t.envio,
      subtotal: t.subtotal,
      iva: t.iva,
      total: t.total,
      items: t.lineas.map((l, orden) => ({ ...l, orden })),
    };
  };

  it("Base imponible, IVA 21 % y total: los guardados, los de la lista", () => {
    const d = documentoPresupuesto(
      guardado([
        {
          descripcion: "DTF por metros",
          cantidad: 6.889,
          unidad: "m",
          precio_unitario: 7,
          iva_rate: 21,
        },
      ]),
    );
    expect(d.base).toBe(48.22);
    expect(d.iva).toEqual([{ tipo: 21, cuota: 10.13 }]);
    expect(d.total).toBe(58.35);
    expect(d.metros).toBe(6.889);
    expect(d.validoHasta).toBe("2026-11-15");
  });

  it("el envío va como una línea más y la columna suma la base imponible", () => {
    const d = documentoPresupuesto(
      guardado(
        [
          {
            descripcion: "DTF por metros",
            cantidad: 3,
            unidad: "m",
            precio_unitario: 7,
            iva_rate: 21,
          },
          { descripcion: "Montaje", cantidad: 2, unidad: "ud", precio_unitario: 4.5, iva_rate: 21 },
        ],
        5.99,
      ),
    );
    expect(d.lineas.at(-1)).toEqual({
      descripcion: DESCRIPCION_ENVIO,
      cantidad: 1,
      unidad: "ud",
      precio_unitario: 5.99,
      iva_rate: 21,
      importe: 5.99,
    });
    expect(d.lineas.reduce((s, l) => s + l.importe, 0)).toBeCloseTo(d.base, 10);
    expect(d.base).toBe(35.99);
    expect(d.iva).toEqual([{ tipo: 21, cuota: 7.56 }]);
    expect(d.total).toBe(43.55);
    // Los metros son los de las líneas en metros: ni el montaje ni el envío.
    expect(d.metros).toBe(3);
  });

  it("varios tipos: una fila de IVA por tipo, de mayor a menor", () => {
    const d = documentoPresupuesto(
      guardado([
        { descripcion: "Libro", cantidad: 1, unidad: "ud", precio_unitario: 20, iva_rate: 4 },
        { descripcion: "DTF", cantidad: 2, unidad: "m", precio_unitario: 7, iva_rate: 21 },
      ]),
    );
    expect(d.iva).toEqual([
      { tipo: 21, cuota: 2.94 },
      { tipo: 4, cuota: 0.8 },
    ]);
    expect(d.total).toBe(37.74);
  });

  it("sin IVA, el envío tampoco lo lleva", () => {
    const d = documentoPresupuesto(
      guardado(
        [
          {
            descripcion: "Exportación",
            cantidad: 1,
            unidad: "ud",
            precio_unitario: 100,
            iva_rate: 0,
          },
        ],
        10,
      ),
    );
    expect(d.lineas.at(-1)?.iva_rate).toBe(0);
    expect(d.iva).toEqual([{ tipo: 0, cuota: 0 }]);
    expect(d.total).toBe(110);
  });

  it("las líneas salen en su orden y las cifras pueden llegar como texto", () => {
    const d = documentoPresupuesto({
      fecha: "2026-10-16",
      validez_dias: 15,
      envio: "0",
      subtotal: "21.00",
      iva: "4.41",
      total: "25.41",
      items: [
        {
          orden: 1,
          descripcion: "B",
          cantidad: "1",
          unidad: "ud",
          precio_unitario: "14",
          iva_rate: "21",
          subtotal: "14.00",
        },
        {
          orden: 0,
          descripcion: "A",
          cantidad: "1.000",
          unidad: null,
          precio_unitario: "7",
          iva_rate: "21.00",
          subtotal: "7.00",
        },
      ],
    });
    expect(d.lineas.map((l) => l.descripcion)).toEqual(["A", "B"]);
    expect(d.lineas[0].unidad).toBe("ud");
    expect(d.iva).toEqual([{ tipo: 21, cuota: 4.41 }]);
  });

  it("si lo guardado no cuadra con las líneas, no se inventa el reparto: el IVA guardado", () => {
    const d = documentoPresupuesto({
      fecha: "2026-10-16",
      validez_dias: 30,
      envio: 0,
      subtotal: 100,
      iva: 20.99,
      total: 120.99,
      items: [
        {
          descripcion: "X",
          cantidad: 1,
          unidad: "ud",
          precio_unitario: 100,
          iva_rate: 21,
          subtotal: 100,
        },
      ],
    });
    expect(d.iva).toEqual([{ tipo: 21, cuota: 20.99 }]);
    expect(d.total).toBe(120.99);

    const mezcla = documentoPresupuesto({
      fecha: "2026-10-16",
      validez_dias: 30,
      envio: 0,
      subtotal: 120,
      iva: 9,
      total: 129,
      items: [
        {
          descripcion: "X",
          cantidad: 1,
          unidad: "ud",
          precio_unitario: 100,
          iva_rate: 21,
          subtotal: 100,
        },
        {
          descripcion: "Y",
          cantidad: 1,
          unidad: "ud",
          precio_unitario: 20,
          iva_rate: 4,
          subtotal: 20,
        },
      ],
    });
    expect(mezcla.iva).toEqual([{ tipo: null, cuota: 9 }]);
  });
});
