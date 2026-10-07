import { describe, expect, it } from "vitest";
import {
  avisoDuplicado,
  avisosQueImportan,
  bloqueaRegistro,
  claveNumero,
  claveProveedor,
  duplicadosDe,
  ESQUEMA_LECTURA_JSON,
  motivosRevision,
  validarLectura,
  type CompraComparable,
} from "./cola-compras";

const c = (id: string, extra: Partial<CompraComparable> = {}): CompraComparable => ({
  id,
  proveedor: "Tintas DTF S.L.",
  nif_proveedor: "B-12.345.678",
  numero: "F-0123",
  fecha: "2026-10-03",
  liquido: 121,
  fichero_huella: `h-${id}`,
  estado: "registrada",
  borrada_en: null,
  ...extra,
});

describe("claves como en la base", () => {
  it("«F-0123» y «f 0123» son la misma; sin NIF, el nombre", () => {
    expect(claveNumero("F-0123")).toBe(claveNumero("f 0123"));
    expect(claveProveedor("b-12.345.678", "x")).toBe("B12345678");
    expect(claveProveedor(null, "Mensajería Rápida, S.L.")).toBe("MENSAJERARPIDASL");
    expect(claveProveedor("", null)).toBe("");
  });
});

describe("duplicados en tres niveles", () => {
  const registrada = c("a");

  it("1. el mismo fichero, aunque se llame distinto", () => {
    const [d] = duplicadosDe(c("b", { fichero_huella: "h-a", numero: "otro" }), [registrada]);
    expect(d.nivel).toBe("archivo");
    expect(bloqueaRegistro(d)).toBe(true);
    expect(avisoDuplicado(d)).toContain("Este fichero ya está subido");
  });

  it("2. la misma factura en otro fichero (PDF del correo y escaneo)", () => {
    const [d] = duplicadosDe(c("b", { numero: "f 0123", nif_proveedor: "B12345678" }), [
      registrada,
    ]);
    expect(d.nivel).toBe("factura");
    expect(bloqueaRegistro(d)).toBe(true);
  });

  it("3. mismo proveedor, fecha e importe sin número: solo aviso", () => {
    const [d] = duplicadosDe(c("b", { numero: null }), [registrada]);
    expect(d.nivel).toBe("probable");
    expect(bloqueaRegistro(d)).toBe(false);
    expect(avisoDuplicado(d)).toContain("Posible duplicado");
  });

  it("otra factura del mismo proveedor no es duplicado", () => {
    expect(duplicadosDe(c("b", { numero: "F-0124", liquido: 99 }), [registrada])).toEqual([]);
    // Mismo importe y proveedor, otro día: tampoco.
    expect(duplicadosDe(c("b", { numero: null, fecha: "2026-10-04" }), [registrada])).toEqual([]);
  });

  it("si la otra está borrada, avisa pero no bloquea", () => {
    const [d] = duplicadosDe(c("b"), [{ ...registrada, borrada_en: "2026-10-05T10:00:00Z" }]);
    expect(d.borrada).toBe(true);
    expect(bloqueaRegistro(d)).toBe(false);
    expect(avisoDuplicado(d)).toContain("Ya la subiste y la borraste");
  });

  it("dos copias en la cola: avisa, no bloquea (ninguna está registrada)", () => {
    const [d] = duplicadosDe(c("b", { estado: "borrador" }), [c("a", { estado: "borrador" })]);
    expect(d.nivel).toBe("factura");
    expect(bloqueaRegistro(d)).toBe(false);
  });

  it("no se compara consigo misma", () => {
    expect(duplicadosDe(registrada, [registrada])).toEqual([]);
  });
});

const lecturaBuena = {
  proveedor: "Tintas DTF S.L.",
  nif_proveedor: "B12345678",
  numero: "F-0123",
  fecha: "03/10/2026",
  concepto: "Tinta blanca",
  categoria: "consumibles",
  base: "100,00",
  iva: "21,00",
  irpf: null,
  total: "121,00",
  confianza: 0.97,
  dudas: [],
  lineas: [
    {
      descripcion: "Tinta blanca 1L",
      cantidad: "2",
      unidad: "ud",
      precio_unitario: "50,00",
      importe: "100,00",
    },
  ],
};

describe("validar la lectura de la IA", () => {
  it("una lectura con la forma esperada vale", () => {
    expect(validarLectura(lecturaBuena)).toMatchObject({ ok: true });
  });

  it("sin un campo, con una categoría inventada o confianza fuera de rango, no", () => {
    const sinConfianza: Record<string, unknown> = { ...lecturaBuena };
    delete sinConfianza.confianza;
    expect(validarLectura(sinConfianza)).toMatchObject({ ok: false });
    expect(validarLectura({ ...lecturaBuena, categoria: "caprichos" })).toMatchObject({
      ok: false,
    });
    const r = validarLectura({ ...lecturaBuena, confianza: 1.4 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("La lectura no tiene la forma esperada: confianza está fuera de rango.");
    }
    expect(validarLectura("no es json")).toMatchObject({ ok: false });
  });

  it("el JSON Schema pide los mismos campos que el esquema", () => {
    expect([...ESQUEMA_LECTURA_JSON.required].sort()).toEqual(Object.keys(lecturaBuena).sort());
  });
});

describe("motivos de revisión", () => {
  const base = {
    confianza: 0.95,
    dudas: [] as string[],
    avisos: [] as { linea: number | null; mensaje: string }[],
    tipoIva: 0.21,
    categoria: "consumibles",
    duplicados: [],
  };

  it("sin nada raro, ningún motivo (pero la confirma igual una persona)", () => {
    expect(motivosRevision(base)).toEqual([]);
  });

  it("poca confianza, dudas, cuentas, tipo y categoría: todo escrito", () => {
    const m = motivosRevision({
      ...base,
      confianza: 0.6,
      dudas: ["el número está borroso"],
      avisos: [{ linea: 0, mensaje: "2 × 50 son 100, no 110." }],
      tipoIva: null,
      categoria: null,
    });
    expect(m).toEqual([
      "La IA no está segura de su lectura (confianza 60 %).",
      "La IA duda: el número está borroso",
      "Línea 1: 2 × 50 son 100, no 110.",
      "El IVA leído no cuadra con ningún tipo: elige el tipo a mano.",
      "La IA no sabe qué es: elige la categoría.",
    ]);
  });

  it("un duplicado va el primero", () => {
    const [d] = duplicadosDe(c("b", { numero: null }), [c("a")]);
    expect(motivosRevision({ ...base, duplicados: [d] })[0]).toContain("Posible duplicado");
  });
});

describe("avisos según lo que se compra", () => {
  const avisos = [
    { linea: null, mensaje: "No se ha leído ninguna línea." },
    { linea: null, mensaje: "Base 100 más IVA 21 son 121, no 120." },
  ];
  it("sin líneas solo importa en el textil", () => {
    expect(avisosQueImportan(avisos, "consumibles")).toHaveLength(1);
    expect(avisosQueImportan(avisos, "textil")).toHaveLength(2);
    expect(avisosQueImportan(avisos, "")).toHaveLength(2);
  });
});
