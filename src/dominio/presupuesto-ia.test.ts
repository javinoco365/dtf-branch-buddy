import { describe, expect, it } from "vitest";
import {
  ESQUEMA_LECTURA_PRESUPUESTO_JSON,
  MAXIMO_CATALOGO_IA,
  avisoCatalogoParcial,
  casarCliente,
  catalogoTextilParaIa,
  catalogoTiendaParaIa,
  montarBorradorTextil,
  montarBorradorTienda,
  ordenarPorPista,
  precioLeido,
  revisarDocumentoIa,
  unidadNormalizada,
  validarLecturaPresupuesto,
  type LecturaPresupuesto,
  type LineaLeidaPresupuesto,
} from "./presupuesto-ia";
import { MAXIMO_UNIONES_API } from "./cola-compras";
import { totalesPresupuesto } from "./presupuestos";
import type { VarianteCatalogo } from "./tipos-textil";

const linea = (l: Partial<LineaLeidaPresupuesto> = {}): LineaLeidaPresupuesto => ({
  catalogo_id: "",
  descripcion: "",
  cantidad: "",
  unidad: "",
  precio_unitario: "",
  importe: "",
  precio_con_iva: "",
  ...l,
});

const lectura = (l: Partial<LecturaPresupuesto> = {}): LecturaPresupuesto => ({
  cliente_nombre: "",
  cliente_email: "",
  cliente_telefono: "",
  cliente_nif: "",
  cliente_direccion: "",
  fecha: "",
  validez_dias: "",
  con_iva: "",
  envio: "",
  notas: "",
  lineas: [],
  dudas: [],
  ...l,
});

const HOY = "2026-10-20";

const productos = [
  {
    id: "p-metro",
    nombre: "Metro DTF",
    descripcion: "Film 58 cm",
    unidad: "m",
    precio_unitario: 12,
  },
  { id: "p-sin", nombre: "Diseño a medida", unidad: "ud", precio_unitario: 0 },
];

const clientes = [
  {
    id: "c-pepe",
    nombre: "Pepe SL",
    email: "compras@pepe.es",
    telefono: "600000000",
    nif: "B12345678",
  },
  { id: "c-ana", nombre: "Ana Pérez", email: null, telefono: null, nif: null },
  { id: "c-ana2", nombre: "Ana Perez", email: "otra@ana.es", telefono: null, nif: null },
];

const variante = (v: Partial<VarianteCatalogo>): VarianteCatalogo => ({
  id: "v",
  producto_id: null,
  producto: null,
  nombre: "Camiseta",
  sku: null,
  ean: null,
  color: null,
  talla: null,
  categoria: null,
  cantidad: 0,
  cantidad_reservada: 0,
  cantidad_minima: 0,
  coste_unitario: 0,
  precio_venta: 0,
  activa: true,
  repetida: false,
  ...v,
});

const variantes = [
  variante({
    id: "v-negra-m",
    producto: {
      id: "pr",
      marca: "Gildan",
      referencia: null,
      nombre: "Heavy Cotton",
      categoria: null,
      activo: true,
    },
    nombre: "Heavy Cotton",
    color: "Negro",
    talla: "M",
    sku: "G5000-BK-M",
    cantidad: 80,
    cantidad_reservada: 10,
    precio_venta: 6.5,
  }),
  variante({ id: "v-apagada", nombre: "Sudadera", activa: false, precio_venta: 20 }),
];

describe("el esquema que se pide a la IA", () => {
  it("cabe en los límites de la API: sin uniones (≤16) y sin opcionales (≤24)", () => {
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
    recorrer(ESQUEMA_LECTURA_PRESUPUESTO_JSON);
    expect(uniones).toBeLessThanOrEqual(MAXIMO_UNIONES_API);
    expect(opcionales).toBeLessThanOrEqual(24);
    expect(JSON.stringify(ESQUEMA_LECTURA_PRESUPUESTO_JSON)).not.toContain("anyOf");
  });

  it("pide todos los campos que valida el dominio, y ninguno más", () => {
    const e = ESQUEMA_LECTURA_PRESUPUESTO_JSON;
    expect([...e.required].sort()).toEqual(Object.keys(lectura()).sort());
    expect([...e.properties.lineas.items.required].sort()).toEqual(Object.keys(linea()).sort());
    expect(Object.keys(e.properties).sort()).toEqual([...e.required].sort());
  });
});

describe("validarLecturaPresupuesto", () => {
  it("acepta una lectura completa", () => {
    const r = validarLecturaPresupuesto(lectura({ lineas: [linea({ descripcion: "x" })] }));
    expect(r.ok).toBe(true);
  });

  it("rechaza lo que no tiene la forma, y dice dónde, en castellano", () => {
    const sinLineas = { ...lectura() } as Record<string, unknown>;
    delete sinLineas.lineas;
    expect(validarLecturaPresupuesto(sinLineas)).toEqual({
      ok: false,
      error: "La IA ha devuelto un presupuesto sin la forma esperada: lineas falta.",
    });
    const r = validarLecturaPresupuesto(lectura({ con_iva: "quizá" as "si" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("con_iva no es un valor permitido");
    expect(validarLecturaPresupuesto(null).ok).toBe(false);
  });
});

describe("el catálogo que ve la IA", () => {
  it("de la tienda: id, nombre, descripción, unidad y precio sin IVA", () => {
    expect(catalogoTiendaParaIa(productos)).toBe(
      "p-metro | Metro DTF | Film 58 cm | m | 12 €\np-sin | Diseño a medida | ud | sin precio",
    );
    expect(catalogoTiendaParaIa([])).toContain("no tiene productos");
  });

  it("del textil: solo las variantes que se venden, con su precio y lo disponible", () => {
    expect(catalogoTextilParaIa(variantes)).toBe(
      "v-negra-m | Gildan · Heavy Cotton · Negro · M | SKU G5000-BK-M | 6.5 € | 70 disponibles",
    );
  });
});

describe("el catálogo que no cabe entero", () => {
  const muchas = Array.from({ length: MAXIMO_CATALOGO_IA + 300 }, (_, i) =>
    variante({
      id: `v-${String(i).padStart(4, "0")}`,
      nombre: i === MAXIMO_CATALOGO_IA + 250 ? "Stanley Creator" : `Básica ${i}`,
      color: i === MAXIMO_CATALOGO_IA + 250 ? "Blanco" : "Gris",
      talla: "M",
    }),
  );

  it("primero lo que se parece a lo que se pide: una variante del final entra", () => {
    const sinPista = catalogoTextilParaIa(muchas);
    expect(sinPista).not.toContain("Stanley");
    expect(sinPista).toContain("(y 300 variantes más que no caben aquí)");
    const conPista = catalogoTextilParaIa(muchas, "20 camisetas Stanley/Stella blancas M");
    expect(conPista.split("\n")[0]).toContain("Stanley Creator");
  });

  it("ordenarPorPista: a igualdad, el orden de siempre; sin tildes ni mayúsculas", () => {
    const l = ["Camiseta roja", "Sudadera azul", "Camiseta azul"];
    expect(ordenarPorPista(l, (x) => x, "")).toEqual(l);
    expect(ordenarPorPista(l, (x) => x, "SUDADERA azúl")).toEqual([
      "Sudadera azul",
      "Camiseta azul",
      "Camiseta roja",
    ]);
  });

  it("si se recorta, el borrador lo avisa; si cabe, no", () => {
    expect(avisoCatalogoParcial(MAXIMO_CATALOGO_IA, "variantes")).toBeNull();
    const aviso = avisoCatalogoParcial(MAXIMO_CATALOGO_IA + 300, "variantes");
    expect(aviso).toContain(`${MAXIMO_CATALOGO_IA} de ${MAXIMO_CATALOGO_IA + 300} variantes`);
    expect(aviso).toContain("sin stock");
  });
});

describe("revisarDocumentoIa", () => {
  const jpeg = (ancho: number, alto: number) =>
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      8,
      alto >> 8,
      alto & 0xff,
      ancho >> 8,
      ancho & 0xff,
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
      0xff,
      0xd9,
    ]);

  it("un PDF hasta 10 MB; una foto hasta 5 MB y 8000 px de lado", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF");
    expect(revisarDocumentoIa(pdf, "application/pdf")).toEqual({
      ok: true,
      esImagen: false,
    });
    // Lo que el navegador llama PDF pero no lo es, no va a la IA.
    expect(revisarDocumentoIa(new Uint8Array(10), "application/pdf").ok).toBe(false);
    const pdfGrande = revisarDocumentoIa(new Uint8Array(10 * 1024 * 1024 + 1), "application/pdf");
    expect(pdfGrande.ok).toBe(false);
    expect(revisarDocumentoIa(jpeg(4000, 3000), "image/jpeg")).toEqual({
      ok: true,
      esImagen: true,
    });
    const fotoPesada = new Uint8Array(7 * 1024 * 1024);
    fotoPesada.set(jpeg(4000, 3000));
    const r = revisarDocumentoIa(fotoPesada, "image/jpeg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("5 MB");
    const ancha = revisarDocumentoIa(jpeg(9000, 3000), "image/jpeg");
    expect(ancha.ok).toBe(false);
    if (!ancha.ok) expect(ancha.error).toContain("8000");
  });

  it("ni otros formatos ni una imagen que no es lo que dice", () => {
    expect(revisarDocumentoIa(new Uint8Array(10), "image/gif").ok).toBe(false);
    expect(revisarDocumentoIa(jpeg(100, 100), "image/png").ok).toBe(false);
  });
});

describe("casarCliente", () => {
  it("por correo, por NIF o por nombre exacto (sin tildes), y solo si hay uno", () => {
    expect(casarCliente(lectura({ cliente_email: " Compras@Pepe.es " }), clientes)?.id).toBe(
      "c-pepe",
    );
    expect(casarCliente(lectura({ cliente_nif: "b-12345678" }), clientes)?.id).toBe("c-pepe");
    expect(casarCliente(lectura({ cliente_nombre: "pepe sl" }), clientes)?.id).toBe("c-pepe");
    // «Ana Pérez» y «Ana Perez» son la misma sin tildes: dos posibles, ninguno.
    expect(casarCliente(lectura({ cliente_nombre: "Ana Pérez" }), clientes)).toBeNull();
    expect(casarCliente(lectura({ cliente_nombre: "Nadie" }), clientes)).toBeNull();
    expect(casarCliente(lectura(), clientes)).toBeNull();
  });
});

describe("precioLeido y unidadNormalizada", () => {
  it("el precio del papel; si solo hay importe, entre la cantidad; con IVA, a base", () => {
    expect(precioLeido(linea({ precio_unitario: "10,50" }), 2, 21)).toEqual({
      precio: 10.5,
      conIvaQuitado: false,
    });
    expect(precioLeido(linea({ importe: "500" }), 50, 21)).toEqual({
      precio: 10,
      conIvaQuitado: false,
    });
    expect(precioLeido(linea({ precio_unitario: "12,10", precio_con_iva: "si" }), 1, 21)).toEqual({
      precio: 10,
      conIvaQuitado: true,
    });
    // Sin IVA en el presupuesto, no hay nada que quitar.
    expect(
      precioLeido(linea({ precio_unitario: "12,10", precio_con_iva: "si" }), 1, 0).precio,
    ).toBe(12.1);
    expect(precioLeido(linea({ precio_unitario: "" }), 3, 21).precio).toBeNull();
    expect(precioLeido(linea({ precio_unitario: "-4" }), 3, 21).precio).toBeNull();
    expect(precioLeido(linea({ importe: "30" }), null, 21).precio).toBeNull();
  });

  it("las unidades como las escribe la gente", () => {
    expect(unidadNormalizada("metros")).toBe("m");
    expect(unidadNormalizada("Uds.")).toBe("ud");
    expect(unidadNormalizada("caja")).toBe("caja");
    expect(unidadNormalizada("")).toBeNull();
    expect(unidadNormalizada("paquetes grandes")).toBeNull();
  });
});

describe("montarBorradorTienda", () => {
  it("el texto de Javier: cliente de la ficha, precio del texto, cantidades y fecha de hoy", () => {
    const b = montarBorradorTienda(
      lectura({
        cliente_nombre: "Pepe SL",
        lineas: [
          linea({
            catalogo_id: "p-metro",
            descripcion: "Metro DTF con logo",
            cantidad: "50",
            unidad: "metros",
            precio_unitario: "10",
          }),
        ],
      }),
      { productos, clientes, hoy: HOY },
    );
    expect(b).toMatchObject({
      cliente_id: "c-pepe",
      cliente_nombre: "Pepe SL",
      cliente_email: "compras@pepe.es",
      cliente_telefono: "600000000",
      fecha: HOY,
      validez_dias: 30,
      envio: 0,
      aplica_iva: true,
      lineas: [
        {
          producto_id: "p-metro",
          descripcion: "Metro DTF con logo",
          cantidad: 50,
          unidad: "m",
          precio_unitario: 10,
        },
      ],
    });
    expect(b.avisos).toEqual([]);
  });

  it("sin precio en el texto, el del catálogo; sin ninguno, vacío y se avisa", () => {
    const b = montarBorradorTienda(
      lectura({
        cliente_nombre: "Cliente nuevo",
        lineas: [
          linea({ catalogo_id: "p-metro", cantidad: "3" }),
          linea({ catalogo_id: "p-sin", descripcion: "Diseño", cantidad: "1" }),
          linea({ descripcion: "Algo libre", cantidad: "" }),
        ],
      }),
      { productos, clientes, hoy: HOY },
    );
    expect(
      b.lineas.map((l) => [l.producto_id, l.descripcion, l.cantidad, l.unidad, l.precio_unitario]),
    ).toEqual([
      ["p-metro", "Metro DTF", 3, "m", 12],
      ["p-sin", "Diseño", 1, "ud", null],
      [null, "Algo libre", null, "ud", null],
    ]);
    expect(b.cliente_id).toBeNull();
    expect(b.cliente_nombre).toBe("Cliente nuevo");
    expect(b.avisos).toEqual([
      "«Cliente nuevo» no está en la ficha de clientes: va sin ficha. Elígelo si ya existe con otro nombre.",
      "Línea 2: no hay precio, ni en el texto ni en el catálogo.",
      "Línea 3: falta la cantidad.",
      "Línea 3: no hay precio, ni en el texto ni en el catálogo.",
    ]);
  });

  it("un producto inventado por la IA va como línea libre; las dudas de la IA, primero", () => {
    const b = montarBorradorTienda(
      lectura({
        cliente_email: "compras@pepe.es",
        dudas: ["No se lee bien la cantidad de la segunda línea."],
        lineas: [
          linea({
            catalogo_id: "p-inventado",
            descripcion: "Film",
            cantidad: "2",
            precio_unitario: "5",
          }),
        ],
      }),
      { productos, clientes, hoy: HOY },
    );
    expect(b.lineas[0].producto_id).toBeNull();
    expect(b.avisos[0]).toBe("No se lee bien la cantidad de la segunda línea.");
    expect(b.avisos[1]).toContain("no está en el catálogo");
  });

  it("sin IVA, envío, fecha y validez del papel; y los totales, con el dominio de siempre", () => {
    const b = montarBorradorTienda(
      lectura({
        cliente_nombre: "Pepe SL",
        fecha: "15/11/2026",
        validez_dias: "15",
        con_iva: "no",
        envio: "8,50",
        notas: "Entrega en 5 días",
        lineas: [linea({ descripcion: "Metro DTF", cantidad: "2", precio_unitario: "12" })],
      }),
      { productos, clientes, hoy: HOY },
    );
    expect(b).toMatchObject({
      fecha: "2026-11-15",
      validez_dias: 15,
      aplica_iva: false,
      envio: 8.5,
      notas: "Entrega en 5 días",
    });
    const t = totalesPresupuesto(
      b.lineas.map((l) => ({
        ...l,
        cantidad: l.cantidad ?? 0,
        precio_unitario: l.precio_unitario ?? 0,
        iva_rate: 0,
      })),
      b.envio,
    );
    expect(t.total).toBe(32.5);
  });

  it("sin cliente ni líneas: lo dice", () => {
    const b = montarBorradorTienda(lectura({ fecha: "mañana" }), { productos, clientes, hoy: HOY });
    expect(b.fecha).toBe(HOY);
    expect(b.avisos).toEqual([
      "No se entiende la fecha «mañana»: se pone la de hoy.",
      "No se dice para qué cliente es: elígelo o escríbelo.",
      "La IA no ha encontrado ninguna línea: añádelas a mano.",
    ]);
  });
});

describe("montarBorradorTextil", () => {
  it("50 camisetas Gildan negras M con logo, 10 € cada una, para Pepe SL", () => {
    const b = montarBorradorTextil(
      lectura({
        cliente_nombre: "Pepe SL",
        lineas: [
          linea({
            catalogo_id: "v-negra-m",
            descripcion: "Camiseta Gildan negra M con logo en pecho",
            cantidad: "50",
            precio_unitario: "10",
          }),
        ],
      }),
      { variantes, clientes, hoy: HOY },
    );
    expect(b).toMatchObject({
      cliente_id: "c-pepe",
      cliente_nombre: "Pepe SL",
      cliente_nif: "B12345678",
      lineas: [
        {
          stock_id: "v-negra-m",
          descripcion: "Camiseta Gildan negra M con logo en pecho",
          cantidad: 50,
          precio_unitario: 10,
          iva_pct: 21,
        },
      ],
      avisos: [],
    });
  });

  it("sin precio, el de venta de la variante; una variante apagada o inventada va sin stock", () => {
    const b = montarBorradorTextil(
      lectura({
        cliente_nombre: "Pepe SL",
        con_iva: "no",
        envio: "6",
        lineas: [
          linea({ catalogo_id: "v-negra-m", cantidad: "10" }),
          linea({ catalogo_id: "v-apagada", descripcion: "Sudadera", cantidad: "2" }),
          linea({
            catalogo_id: "v-nada",
            descripcion: "Gorra",
            cantidad: "1",
            precio_unitario: "4",
          }),
        ],
      }),
      { variantes, clientes, hoy: HOY },
    );
    expect(b.lineas.map((l) => [l.stock_id, l.descripcion, l.precio_unitario, l.iva_pct])).toEqual([
      ["v-negra-m", "Gildan · Heavy Cotton · Negro · M", 6.5, 0],
      [null, "Sudadera", null, 0],
      [null, "Gorra", 4, 0],
    ]);
    expect(b.avisos).toEqual([
      "Línea 2: la variante que encaja está desactivada o repetida; va sin stock.",
      "Línea 2: no hay precio, ni en el texto ni en el precio de venta del stock.",
      "Línea 3: la IA ha citado una variante que no está en el stock; va sin stock.",
      "El texto habla de un envío de 6: los presupuestos textil no llevan envío aparte; añádelo como línea si va.",
    ]);
  });
});
