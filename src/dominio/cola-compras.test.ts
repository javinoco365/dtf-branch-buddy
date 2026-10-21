import { describe, expect, it } from "vitest";
import {
  avisoDuplicado,
  avisosQueImportan,
  bloqueaRegistro,
  claveNumero,
  claveProveedor,
  duplicadosDe,
  ESQUEMA_LECTURA_JSON,
  MAXIMO_UNIONES_API,
  motivosRevision,
  referenciaProformaDe,
  tipoDocumentoLeido,
  validarLectura,
  type CompraComparable,
} from "./cola-compras";
import type { ProformaFila, SugerenciaProforma } from "./proformas";

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
  tipo_documento: "factura",
  referencia_proforma: "",
  lineas: [
    {
      descripcion: "Tinta blanca 1L",
      cantidad: "2",
      unidad: "ud",
      precio_unitario: "50,00",
      importe: "100,00",
      linea_papel: "",
      importe_linea_papel: "",
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

  it("las claves del escáner textil son tolerantes: si faltan, null; un tipo raro, null", () => {
    const r = validarLectura(lecturaBuena);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lectura.lineas[0].tipo ?? null).toBeNull();
      expect(r.lectura.lineas[0]).toMatchObject({
        referencia: null,
        marca: null,
        modelo: null,
        color: null,
        talla: null,
        ean: null,
        unidades_por_pack: null,
      });
    }
    const conTextil = {
      ...lecturaBuena,
      lineas: [
        {
          ...lecturaBuena.lineas[0],
          tipo: "porte",
          referencia: "5000",
          marca: "Gildan",
          modelo: null,
          color: "Negro",
          talla: "XL",
          ean: "4006381333931",
          unidades_por_pack: "5",
        },
        { ...lecturaBuena.lineas[0], tipo: "envio" },
      ],
    };
    const r2 = validarLectura(conTextil);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.lectura.lineas[0]).toMatchObject({
        tipo: "porte",
        referencia: "5000",
        unidades_por_pack: "5",
      });
      expect(r2.lectura.lineas[1].tipo).toBeNull();
    }
  });

  it("el JSON Schema de las líneas pide las ocho claves del escáner", () => {
    const lineas = ESQUEMA_LECTURA_JSON.properties.lineas.items;
    expect([...lineas.required].sort()).toEqual(
      [
        "descripcion",
        "cantidad",
        "unidad",
        "precio_unitario",
        "importe",
        "tipo",
        "referencia",
        "marca",
        "modelo",
        "color",
        "talla",
        "ean",
        "unidades_por_pack",
        "linea_papel",
        "importe_linea_papel",
      ].sort(),
    );
    expect(Object.keys(lineas.properties).sort()).toEqual([...lineas.required].sort());
    expect(lineas.properties.tipo).toEqual({
      type: "string",
      enum: ["articulo", "porte", "descuento", "otro"],
    });
  });

  it("el JSON Schema cabe en los límites de la API (si no, responde 400)", () => {
    // Cuenta los campos con unión (anyOf o lista de tipos) y los opcionales.
    let uniones = 0;
    let opcionales = 0;
    const recorrer = (nodo: unknown) => {
      if (!nodo || typeof nodo !== "object") return;
      const n = nodo as Record<string, unknown>;
      if (n.anyOf || Array.isArray(n.type)) uniones += 1;
      if (n.properties && typeof n.properties === "object") {
        const requeridos = new Set((n.required as string[] | undefined) ?? []);
        for (const [clave, hijo] of Object.entries(n.properties)) {
          if (!requeridos.has(clave)) opcionales += 1;
          recorrer(hijo);
        }
      }
      if (n.items) recorrer(n.items);
      if (Array.isArray(n.anyOf)) n.anyOf.forEach(recorrer);
    };
    recorrer(ESQUEMA_LECTURA_JSON);
    expect(uniones).toBeLessThanOrEqual(MAXIMO_UNIONES_API);
    expect(opcionales).toBeLessThanOrEqual(24);
  });

  it("un texto vacío de la IA vale lo mismo que null", () => {
    const r = validarLectura({
      ...lecturaBuena,
      numero: "",
      categoria: "",
      lineas: [{ ...lecturaBuena.lineas[0], unidad: " ", marca: "", talla: "XL" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lectura.numero).toBeNull();
      expect(r.lectura.categoria).toBeNull();
      expect(r.lectura.lineas[0]).toMatchObject({ unidad: null, marca: null, talla: "XL" });
    }
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
      "La IA no está segura de su lectura (confianza 60\u00A0%).",
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

describe("proformas en la cola", () => {
  it("el JSON Schema pide tipo_documento, referencia_proforma y linea_papel, sin uniones", () => {
    expect(ESQUEMA_LECTURA_JSON.required).toContain("tipo_documento");
    expect(ESQUEMA_LECTURA_JSON.required).toContain("referencia_proforma");
    expect(ESQUEMA_LECTURA_JSON.properties.lineas.items.required).toContain("linea_papel");
    expect(ESQUEMA_LECTURA_JSON.properties.lineas.items.required).toContain("importe_linea_papel");
    expect(ESQUEMA_LECTURA_JSON.properties.tipo_documento).toEqual({
      type: "string",
      enum: ["factura", "proforma", ""],
    });
    const texto = JSON.stringify(ESQUEMA_LECTURA_JSON);
    expect(texto).not.toContain("anyOf");
    expect(texto).not.toMatch(/"type":\[/);
  });

  it("zod acepta «», «factura» y «proforma»; un valor raro o ausente da null", () => {
    const leer = (v: unknown) => {
      const r = validarLectura({ ...lecturaBuena, tipo_documento: v });
      return r.ok ? r.lectura.tipo_documento : "error";
    };
    expect(leer("")).toBeNull();
    expect(leer("factura")).toBe("factura");
    expect(leer("proforma")).toBe("proforma");
    expect(leer("albaran")).toBeNull();
    const sin: Record<string, unknown> = { ...lecturaBuena };
    delete sin.tipo_documento;
    delete sin.referencia_proforma;
    const r = validarLectura(sin);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lectura.tipo_documento).toBeNull();
      expect(r.lectura.referencia_proforma).toBeNull();
    }
  });

  it("tipoDocumentoLeido y referenciaProformaDe", () => {
    expect(tipoDocumentoLeido({ tipo_documento: "proforma" })).toBe("proforma");
    expect(tipoDocumentoLeido({ tipo_documento: "factura" })).toBe("factura");
    expect(tipoDocumentoLeido({ tipo_documento: "" })).toBeNull();
    expect(tipoDocumentoLeido(null)).toBeNull();
    expect(tipoDocumentoLeido("proforma")).toBeNull();
    expect(referenciaProformaDe({ referencia_proforma: " PF-12 " })).toBe("PF-12");
    expect(referenciaProformaDe({ referencia_proforma: "" })).toBeNull();
    expect(referenciaProformaDe(undefined)).toBeNull();
  });

  const doc = (extra: Partial<CompraComparable>): CompraComparable => ({
    proveedor: "Textiles Sur",
    nif_proveedor: "B12345678",
    numero: "123",
    fecha: "2026-10-01",
    total: 121,
    estado: "registrada",
    ...extra,
  });

  it("duplicadosDe no marca el par proforma ↔ factura, y sí dos proformas con el mismo número", () => {
    const proforma = doc({ id: "p", tipo_documento: "proforma" });
    const factura = doc({ id: "f", tipo_documento: "factura" });
    // Mismo número y misma fecha e importe: no son duplicados (la factura
    // que llega con su proforma registrada se casa con ella).
    expect(duplicadosDe(factura, [proforma])).toEqual([]);
    // La proforma frente a una factura que aún no está registrada, tampoco.
    expect(duplicadosDe(proforma, [{ ...factura, estado: "borrador" }])).toEqual([]);
    // Sin columna (undefined) es factura: una proforma tampoco la duplica.
    expect(duplicadosDe(doc({ id: "v" }), [proforma])).toEqual([]);
    // El par casado tampoco, aunque por error los dos dijeran factura.
    expect(duplicadosDe(doc({ id: "f2", proforma_id: "p2" }), [doc({ id: "p2" })])).toEqual([]);
    // Dos proformas con el mismo número sí.
    const otra = doc({ id: "p3", tipo_documento: "proforma" });
    const d = duplicadosDe(otra, [proforma]);
    expect(d.map((x) => x.nivel)).toEqual(["factura"]);
    expect(avisoDuplicado(d[0])).toContain("Esta proforma ya está registrada");
    // El mismo fichero sigue siendo duplicado aunque cambie el tipo.
    expect(
      duplicadosDe(doc({ id: "a", fichero_huella: "h" }), [
        doc({ id: "b", tipo_documento: "proforma", fichero_huella: "h" }),
      ]).map((x) => x.nivel),
    ).toEqual(["archivo"]);
  });

  it("duplicadosDe: una proforma cuya factura ya está registrada sin casar", () => {
    const proforma = doc({ id: "p", tipo_documento: "proforma", estado: "borrador" });
    // Mismo número: bloquea (el género ya entró con la factura).
    const [d] = duplicadosDe(proforma, [doc({ id: "f", tipo_documento: "factura" })]);
    expect(d).toMatchObject({ nivel: "factura", facturaDeProforma: true });
    expect(bloqueaRegistro(d)).toBe(true);
    expect(avisoDuplicado(d)).toContain("Esta proforma parece de la factura");
    // Otro número, mismo importe y la factura un mes después: hay que confirmarlo.
    const [p2] = duplicadosDe({ ...proforma, numero: "P-77" }, [
      doc({ id: "f", tipo_documento: "factura", numero: "F-77", fecha: "2026-10-31" }),
    ]);
    expect(p2).toMatchObject({ nivel: "probable", facturaDeProforma: true });
    expect(bloqueaRegistro(p2)).toBe(false);
    expect(avisoDuplicado(p2)).toContain("Esta proforma puede ser de la factura");
    // Otro importe, o ya casada con otra proforma, o de otro proveedor: nada.
    expect(
      duplicadosDe({ ...proforma, numero: "P-77" }, [
        doc({ id: "f", tipo_documento: "factura", numero: "F-77", total: 130 }),
      ]),
    ).toEqual([]);
    expect(
      duplicadosDe(proforma, [doc({ id: "f", tipo_documento: "factura", proforma_id: "otra" })]),
    ).toEqual([]);
    expect(
      duplicadosDe(proforma, [
        doc({ id: "f", tipo_documento: "factura", nif_proveedor: "B99999999", proveedor: "Otro" }),
      ]),
    ).toEqual([]);
    // Más de 90 días: no se sospecha.
    expect(
      duplicadosDe({ ...proforma, numero: "P-77" }, [
        doc({ id: "f", tipo_documento: "factura", numero: "F-77", fecha: "2027-02-01" }),
      ]),
    ).toEqual([]);
  });

  it("motivosRevision: una proforma no textil no dice que mete género", () => {
    expect(
      motivosRevision({
        confianza: 0.95,
        dudas: [],
        avisos: [],
        tipoIva: 0.21,
        categoria: "material",
        duplicados: [],
        tipoDocumento: "proforma",
      }),
    ).toEqual(["Es una proforma: no cuenta en el IVA ni en Gerencia."]);
  });

  it("motivosRevision: tipo dudoso, proforma y proformas sugeridas", () => {
    const base = {
      confianza: 0.95,
      dudas: [] as string[],
      avisos: [],
      tipoIva: 0.21,
      categoria: "textil",
      duplicados: [],
    };
    const pf = (id: string, numero: string | null): SugerenciaProforma => ({
      proforma: {
        id,
        proveedor: "Textiles Sur",
        nif_proveedor: null,
        numero,
        fecha: "2026-10-01",
        base: 100,
        total: 121,
      } as ProformaFila,
      puntos: 10,
      motivos: [],
    });
    expect(motivosRevision({ ...base, tipoDocumento: null })).toEqual([
      "La IA no sabe si es factura o proforma: elígelo.",
    ]);
    expect(
      motivosRevision({ ...base, tipoDocumento: "proforma", proformas: [pf("a", "P1")] }),
    ).toEqual([
      "Es una proforma: mete el género en el stock y no cuenta en el IVA ni en Gerencia.",
    ]);
    expect(
      motivosRevision({
        ...base,
        tipoDocumento: "factura",
        proformas: [pf("a", "P1"), pf("b", null), pf("c", "P3"), pf("d", "P4")],
      }),
    ).toEqual([
      "Puede ser la factura de la proforma P1 del 01/10/2026 (Textiles Sur): cásala al revisarla.",
      "Puede ser la factura de la proforma (sin número) del 01/10/2026 (Textiles Sur): cásala al revisarla.",
      "Puede ser la factura de la proforma P3 del 01/10/2026 (Textiles Sur): cásala al revisarla.",
    ]);
    expect(motivosRevision({ ...base, tipoDocumento: undefined })).toEqual([]);
  });
});
