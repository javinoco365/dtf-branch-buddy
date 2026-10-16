import { describe, expect, it } from "vitest";
import {
  VALIDEZ_TEXTIL_POR_DEFECTO,
  clientePresupuestoTextil,
  contactoPresupuestoTextil,
  documentoPresupuestoTextil,
  documentoPresupuestoTextilVacio,
  identidadBaseTextil,
  lineasPresupuestoTextil,
  validezTextil,
  type LineaPresupuestoTextilGuardada,
} from "./presupuesto-textil";
import { calcularLinea, calcularTotales } from "./importes";
import { DESCRIPCION_ENVIO } from "./presupuestos";

type LineaFormulario = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct: number;
};

/**
 * Lo que guarda `upsertPresupuesto` del textil: cada línea con su base y la
 * cabecera con los totales del dominio, sin envío.
 */
function guardado(lineas: LineaFormulario[], fecha = "2026-10-16", validez_dias: unknown = 30) {
  const t = calcularTotales(lineas.map((l) => ({ ...l, iva_rate: l.iva_pct })));
  return {
    fecha,
    validez_dias: validez_dias as number,
    subtotal: t.base_imponible,
    iva: t.iva_total,
    total: t.total,
    items: lineas.map((l) => ({
      ...l,
      subtotal: calcularLinea({ ...l, iva_rate: l.iva_pct }).base,
      created_at: "2026-10-16T09:00:00.123+00:00",
    })),
  };
}

describe("documentoPresupuestoTextil", () => {
  const camisetas: LineaFormulario[] = [
    {
      descripcion: "Camiseta técnica blanca · talla M · logo pecho",
      cantidad: 25,
      precio_unitario: 6.35,
      iva_pct: 21,
    },
    {
      descripcion: "Camiseta técnica negra · talla L · logo pecho y espalda",
      cantidad: 12,
      precio_unitario: 7.9,
      iva_pct: 21,
    },
    {
      descripcion: "Sudadera capucha gris · talla XL",
      cantidad: 3,
      precio_unitario: 18.45,
      iva_pct: 21,
    },
  ];

  it("base, IVA 21 % y total: los guardados, los mismos que enseña la lista", () => {
    const p = guardado(camisetas);
    const d = documentoPresupuestoTextil(p);
    // 158,75 + 94,80 + 55,35
    expect(d.base).toBe(308.9);
    expect(d.iva).toEqual([{ tipo: 21, cuota: 64.87 }]);
    expect(d.total).toBe(373.77);
    expect(d.total).toBe(p.total);
    // La columna Importe suma la base imponible.
    expect(d.lineas.reduce((s, l) => s + l.importe, 0)).toBeCloseTo(d.base, 2);
  });

  it("las líneas en su orden, en unidades y con la descripción tal cual", () => {
    const d = documentoPresupuestoTextil(guardado(camisetas));
    expect(d.lineas.map((l) => l.descripcion)).toEqual(camisetas.map((l) => l.descripcion));
    expect(d.lineas.every((l) => l.unidad === "ud")).toBe(true);
    expect(d.lineas[0]).toMatchObject({
      cantidad: 25,
      precio_unitario: 6.35,
      iva_rate: 21,
      importe: 158.75,
    });
  });

  it("sin envío y sin metros: el textil no los tiene", () => {
    const d = documentoPresupuestoTextil(guardado(camisetas));
    expect(d.lineas.some((l) => l.descripcion === DESCRIPCION_ENVIO)).toBe(false);
    expect(d.metros).toBe(0);
  });

  it("caduca a los días de validez guardados", () => {
    expect(documentoPresupuestoTextil(guardado(camisetas, "2026-10-16", 15)).validoHasta).toBe(
      "2026-10-31",
    );
    expect(documentoPresupuestoTextil(guardado(camisetas, "2026-12-20", 30)).validoHasta).toBe(
      "2027-01-19",
    );
  });

  it("varios tipos: una fila de IVA por tipo, del mayor al menor", () => {
    const d = documentoPresupuestoTextil(
      guardado([
        { descripcion: "Polo bordado", cantidad: 10, precio_unitario: 12, iva_pct: 21 },
        { descripcion: "Mascarilla higiénica", cantidad: 50, precio_unitario: 0.8, iva_pct: 4 },
        { descripcion: "Muestra sin cargo", cantidad: 1, precio_unitario: 0, iva_pct: 0 },
      ]),
    );
    expect(d.base).toBe(160);
    expect(d.iva).toEqual([
      { tipo: 21, cuota: 25.2 },
      { tipo: 4, cuota: 1.6 },
      { tipo: 0, cuota: 0 },
    ]);
    expect(d.total).toBe(186.8);
  });

  it("las cifras llegan como texto (numeric) y se leen igual", () => {
    const p = guardado(camisetas);
    const comoTexto = {
      ...p,
      validez_dias: "30",
      subtotal: String(p.subtotal),
      iva: String(p.iva),
      total: String(p.total),
      items: p.items.map((l) => ({
        ...l,
        cantidad: String(l.cantidad),
        precio_unitario: String(l.precio_unitario),
        iva_pct: String(l.iva_pct),
        subtotal: String(l.subtotal),
      })),
    };
    expect(documentoPresupuestoTextil(comoTexto as never)).toEqual(documentoPresupuestoTextil(p));
  });

  it("la base guardada de la línea manda: no se recalcula", () => {
    const p = guardado([
      { descripcion: "Gorra bordada", cantidad: 3, precio_unitario: 3.333, iva_pct: 21 },
    ]);
    // 3 × 3,333 = 9,999 → 10,00 al guardar. El PDF dice 10,00, no 9,999.
    expect(p.items[0].subtotal).toBe(10);
    expect(documentoPresupuestoTextil(p).lineas[0].importe).toBe(10);
  });

  it("si lo guardado no cuadra con las líneas, no inventa un reparto", () => {
    const p = { ...guardado(camisetas), iva: 60, total: 368.9 };
    const d = documentoPresupuestoTextil(p);
    expect(d.iva).toEqual([{ tipo: 21, cuota: 60 }]);
    expect(d.total).toBe(368.9);
  });

  it("sin líneas guardadas, un documento vacío con las cifras guardadas", () => {
    const d = documentoPresupuestoTextil({
      fecha: "2026-10-16",
      validez_dias: 30,
      subtotal: 0,
      iva: 0,
      total: 0,
      items: null,
    });
    expect(d.lineas).toEqual([]);
    expect(d.total).toBe(0);
  });
});

describe("lineasPresupuestoTextil", () => {
  const linea = (
    descripcion: string,
    created_at?: string | null,
  ): LineaPresupuestoTextilGuardada => ({
    descripcion,
    cantidad: 1,
    precio_unitario: 1,
    iva_pct: 21,
    subtotal: 1,
    created_at,
  });

  it("en orden de alta", () => {
    const l = lineasPresupuestoTextil([
      linea("B", "2026-10-16T10:00:00Z"),
      linea("A", "2026-10-16T09:00:00Z"),
    ]);
    expect(l.map((x) => x.descripcion)).toEqual(["A", "B"]);
    expect(l.map((x) => x.orden)).toEqual([0, 1]);
  });

  it("las de un mismo guardado comparten instante: se quedan como llegan", () => {
    const t = "2026-10-16T09:00:00Z";
    const l = lineasPresupuestoTextil([
      linea("Primera", t),
      linea("Segunda", t),
      linea("Tercera", t),
    ]);
    expect(l.map((x) => x.descripcion)).toEqual(["Primera", "Segunda", "Tercera"]);
  });

  it("las que no dicen cuándo se dieron de alta, detrás y en su orden", () => {
    const l = lineasPresupuestoTextil([
      linea("Sin fecha 1", null),
      linea("Con fecha", "2026-10-16T09:00:00Z"),
      linea("Sin fecha 2"),
    ]);
    expect(l.map((x) => x.descripcion)).toEqual(["Con fecha", "Sin fecha 1", "Sin fecha 2"]);
  });

  it("la unidad: la de la línea si la trae; si no, unidades", () => {
    const l = lineasPresupuestoTextil([
      { ...linea("Vinilo"), unidad: " m " },
      { ...linea("Camiseta"), unidad: "  " },
      linea("Sudadera"),
    ]);
    expect(l.map((x) => x.unidad)).toEqual(["m", "ud", "ud"]);
  });

  it("el IVA de la línea es iva_pct", () => {
    expect(lineasPresupuestoTextil([{ ...linea("X"), iva_pct: "10" }])[0].iva_rate).toBe("10");
  });

  it("sin líneas, ninguna", () => {
    expect(lineasPresupuestoTextil(undefined)).toEqual([]);
  });
});

describe("validezTextil", () => {
  it("los días guardados, enteros", () => {
    expect(validezTextil(15)).toBe(15);
    expect(validezTextil("7")).toBe(7);
    expect(validezTextil(0)).toBe(0);
  });

  it("sin días, o con algo que no es un número, los de la columna", () => {
    expect(validezTextil(null)).toBe(VALIDEZ_TEXTIL_POR_DEFECTO);
    expect(validezTextil("")).toBe(VALIDEZ_TEXTIL_POR_DEFECTO);
    expect(validezTextil("abc")).toBe(VALIDEZ_TEXTIL_POR_DEFECTO);
    expect(validezTextil(-3)).toBe(VALIDEZ_TEXTIL_POR_DEFECTO);
  });
});

describe("documentoPresupuestoTextilVacio", () => {
  it("sin líneas, todo a cero, válido 30 días desde la fecha", () => {
    expect(documentoPresupuestoTextilVacio("2026-10-16")).toEqual({
      lineas: [],
      base: 0,
      iva: [],
      total: 0,
      metros: 0,
      validoHasta: "2026-11-15",
    });
  });
});

describe("clientePresupuestoTextil", () => {
  const ficha = {
    nombre: "Club Deportivo Cartaya",
    empresa: "Asociación CD Cartaya",
    nif: "G21999999",
    direccion: "Avenida del Deporte 4",
    codigo_postal: "21450",
    ciudad: "Cartaya",
    provincia: "H",
    pais: "España",
    email: "club@cdcartaya.es",
    telefono: "959 00 00 00",
  };

  it("lo congelado en el presupuesto manda; la ficha pone la empresa y el teléfono", () => {
    const c = clientePresupuestoTextil(
      {
        cliente_nombre: "CD Cartaya (equipación)",
        cliente_email: "material@cdcartaya.es",
        cliente_nif: "G21000000",
        cliente_direccion: null,
      },
      ficha,
    );
    expect(c).toEqual({
      nombre: "CD Cartaya (equipación)",
      empresa: "Asociación CD Cartaya",
      nif: "G21000000",
      direccion: ["Avenida del Deporte 4", "21450 Cartaya", "Huelva, España"],
      email: "material@cdcartaya.es",
      telefono: "959 00 00 00",
    });
  });

  it("lo que el presupuesto dejó vacío, de la ficha", () => {
    const c = clientePresupuestoTextil(
      { cliente_nombre: "  ", cliente_email: "", cliente_nif: null },
      ficha,
    );
    expect(c.nombre).toBe("Club Deportivo Cartaya");
    expect(c.email).toBe("club@cdcartaya.es");
    expect(c.nif).toBe("G21999999");
  });

  it("la calle que copió el selector se completa con la ciudad de la ficha", () => {
    const c = clientePresupuestoTextil({ cliente_direccion: "avenida del deporte  4" }, ficha);
    expect(c.direccion).toEqual(["avenida del deporte  4", "21450 Cartaya", "Huelva, España"]);
  });

  it("una dirección escrita a mano sale tal cual, una línea por renglón", () => {
    const c = clientePresupuestoTextil(
      { cliente_direccion: "Pabellón municipal, puerta 2\r\n21450 Cartaya (Huelva)\n" },
      ficha,
    );
    expect(c.direccion).toEqual(["Pabellón municipal, puerta 2", "21450 Cartaya (Huelva)"]);
  });

  it("sin ficha, solo lo congelado", () => {
    const c = clientePresupuestoTextil(
      {
        cliente_nombre: "Peña La Charanga",
        cliente_email: "pena@ejemplo.com",
        cliente_nif: null,
        cliente_direccion: "Calle Real 7",
      },
      null,
    );
    expect(c).toEqual({
      nombre: "Peña La Charanga",
      empresa: null,
      nif: null,
      direccion: ["Calle Real 7"],
      email: "pena@ejemplo.com",
      telefono: null,
    });
  });

  it("sin nada, vacío: no se inventa un cliente", () => {
    expect(clientePresupuestoTextil({}, undefined)).toEqual({
      nombre: "",
      empresa: null,
      nif: null,
      direccion: [],
      email: null,
      telefono: null,
    });
  });
});

describe("identidadBaseTextil", () => {
  it("el nombre, el logo y el color de la marca", () => {
    expect(
      identidadBaseTextil({
        nombre: " Marca Textil ",
        logo_url: "https://ejemplo.com/logo.png",
        color: "#3b82f6",
      }),
    ).toEqual({
      nombre: "Marca Textil",
      logo_url: "https://ejemplo.com/logo.png",
      color: "#3b82f6",
    });
  });

  it("sin marca, vacía", () => {
    expect(identidadBaseTextil(null)).toEqual({ nombre: null, logo_url: null, color: null });
  });
});

describe("contactoPresupuestoTextil", () => {
  const empresa = { email: "fiscal@ejemplo.com", telefono: "600000000" };

  it("el de la marca", () => {
    expect(
      contactoPresupuestoTextil({ email: "hola@marca.es", telefono: "611 22 33 44" }, empresa),
    ).toEqual({ email: "hola@marca.es", telefono: "611 22 33 44" });
  });

  it("lo que la marca no tiene, de la empresa", () => {
    expect(contactoPresupuestoTextil({ email: " ", telefono: null }, empresa)).toEqual(empresa);
    expect(contactoPresupuestoTextil(null, empresa)).toEqual(empresa);
  });

  it("sin ninguno, nada", () => {
    expect(contactoPresupuestoTextil(null, { email: null, telefono: null })).toEqual({
      email: null,
      telefono: null,
    });
  });
});
