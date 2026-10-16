/**
 * La plantilla del PDF de presupuestos: qué sale, dónde y con qué textos.
 *
 * Hay una por tienda y una para el textil (Ajustes generales → PDF de
 * presupuestos). Se guarda en `plantillas_presupuesto.config` como JSON y se
 * lee siempre con `normalizarPlantilla`: lo que falte o venga mal se rellena
 * con lo de por defecto, así que un JSON viejo, a medias o roto nunca impide
 * sacar un presupuesto. Sin plantilla guardada, el PDF sale con
 * `PLANTILLA_POR_DEFECTO`, que es el diseño de siempre.
 *
 * Las posiciones van en milímetros sobre un A4 vertical (210 × 297), medidas
 * desde la esquina de arriba a la izquierda. La cabecera se coloca libre (cada
 * elemento en su x, y); el cuerpo va seguido, porque la tabla crece con las
 * líneas y puede pasar de página: de él se elige el orden y qué se enseña.
 *
 * Lógica pura: sin base de datos ni PDF. La usan el generador, el servidor y
 * el editor.
 */

import { z } from "zod";

export const ANCHO_PAGINA = 210;
export const ALTO_PAGINA = 297;
/** El margen lateral del cuerpo y del pie. */
export const MARGEN = 16;

// ---------------------------------------------------------------------------
// Ámbitos: de quién es cada plantilla
// ---------------------------------------------------------------------------

export type AmbitoPlantilla = { ambito: "tienda"; tiendaId: string } | { ambito: "textil" };

/** Una clave estable para un ámbito: «tienda:<id>» o «textil». */
export function claveAmbito(a: AmbitoPlantilla): string {
  return a.ambito === "tienda" ? `tienda:${a.tiendaId}` : "textil";
}

export function ambitoDeClave(clave: string): AmbitoPlantilla | null {
  if (clave === "textil") return { ambito: "textil" };
  const m = /^tienda:([0-9a-f-]{36})$/i.exec(clave);
  return m ? { ambito: "tienda", tiendaId: m[1] } : null;
}

// ---------------------------------------------------------------------------
// El modelo
// ---------------------------------------------------------------------------

export type Alineacion = "izquierda" | "centro" | "derecha";
export type SeccionFinal = "observaciones" | "condiciones" | "aceptacion";
/** Cuándo sale el nombre comercial en la cabecera. */
export type ModoNombre = "auto" | "siempre" | "nunca";

export type PlantillaPresupuesto = {
  version: 1;
  colores: {
    /** Hexadecimal (#2a2260). Vacío: el color de la tienda o de la marca; si no, el azul de la casa. */
    principal: string;
    /** La línea de la cabecera. Vacío: el principal, o el azul cielo con el azul de la casa. */
    acento: string;
  };
  cabecera: {
    /** Dónde va la línea que separa la cabecera del cuerpo (y, en mm). El cuerpo empieza debajo. */
    alto: number;
    linea: boolean;
    /** El logo se encaja en esta caja sin deformarse. */
    logo: { mostrar: boolean; x: number; y: number; ancho: number; alto: number };
    nombre: {
      /** auto: solo si no hay logo. */
      mostrar: ModoNombre;
      /** Vacío: el de la tienda o el de la marca. */
      texto: string;
      x: number;
      y: number;
      tamano: number;
      alineacion: Alineacion;
    };
    titulo: {
      mostrar: boolean;
      texto: string;
      x: number;
      y: number;
      tamano: number;
      alineacion: Alineacion;
    };
    /** Número, fecha y validez: la etiqueta en x y el valor alineado a la derecha en x + ancho. */
    datos: {
      mostrar: boolean;
      x: number;
      y: number;
      ancho: number;
      etiquetaNumero: string;
      etiquetaFecha: string;
      etiquetaValidez: string;
    };
    /** Un texto libre: un eslogan, una dirección, lo que haga falta. Admite variables. */
    texto: {
      mostrar: boolean;
      texto: string;
      x: number;
      y: number;
      tamano: number;
      alineacion: Alineacion;
    };
  };
  partes: {
    /** Emisor a la izquierda y cliente a la derecha; si no, al revés. */
    emisorPrimero: boolean;
    emisor: {
      mostrar: boolean;
      titulo: string;
      razonSocial: boolean;
      cif: boolean;
      direccion: boolean;
      email: boolean;
      telefono: boolean;
      web: boolean;
    };
    cliente: {
      mostrar: boolean;
      titulo: string;
      empresa: boolean;
      nif: boolean;
      direccion: boolean;
      email: boolean;
      telefono: boolean;
    };
  };
  tabla: {
    descripcion: string;
    cantidad: string;
    precio: string;
    iva: string;
    importe: string;
    mostrarCantidad: boolean;
    mostrarPrecio: boolean;
    mostrarIva: boolean;
  };
  resumen: {
    base: string;
    /** Delante del tipo: «IVA» → «IVA 21 %». */
    iva: string;
    total: string;
    mostrarMetros: boolean;
    metros: string;
  };
  /** El orden de lo que va después del resumen. */
  orden: SeccionFinal[];
  observaciones: { mostrar: boolean; titulo: string };
  /** Una línea por condición. Admite variables. */
  condiciones: { mostrar: boolean; titulo: string; texto: string };
  aceptacion: {
    mostrar: boolean;
    titulo: string;
    texto: string;
    etiquetaFecha: string;
    etiquetaFirma: string;
  };
  pie: {
    /** Los datos fiscales. Hasta tres líneas. Admite variables. */
    texto: string;
    alineacion: Alineacion;
    tamano: number;
    paginas: boolean;
  };
};

export const PLANTILLA_POR_DEFECTO: PlantillaPresupuesto = {
  version: 1,
  colores: { principal: "", acento: "" },
  cabecera: {
    alto: 48,
    linea: true,
    logo: { mostrar: true, x: MARGEN, y: 14, ancho: 52, alto: 22 },
    nombre: {
      mostrar: "auto",
      texto: "",
      x: MARGEN,
      y: 24,
      tamano: 18,
      alineacion: "izquierda",
    },
    titulo: {
      mostrar: true,
      texto: "PRESUPUESTO",
      x: ANCHO_PAGINA - MARGEN,
      y: 23,
      tamano: 24,
      alineacion: "derecha",
    },
    datos: {
      mostrar: true,
      x: ANCHO_PAGINA - MARGEN - 66,
      y: 31,
      ancho: 66,
      etiquetaNumero: "Número",
      etiquetaFecha: "Fecha",
      etiquetaValidez: "Válido hasta",
    },
    texto: {
      mostrar: false,
      texto: "",
      x: MARGEN,
      y: 42,
      tamano: 8.5,
      alineacion: "izquierda",
    },
  },
  partes: {
    emisorPrimero: true,
    emisor: {
      mostrar: true,
      titulo: "Emisor",
      razonSocial: true,
      cif: true,
      direccion: true,
      email: true,
      telefono: true,
      web: true,
    },
    cliente: {
      mostrar: true,
      titulo: "Cliente",
      empresa: true,
      nif: true,
      direccion: true,
      email: true,
      telefono: true,
    },
  },
  tabla: {
    descripcion: "Descripción",
    cantidad: "Cantidad",
    precio: "Precio unit.",
    iva: "IVA",
    importe: "Importe",
    mostrarCantidad: true,
    mostrarPrecio: true,
    mostrarIva: true,
  },
  resumen: {
    base: "Base imponible",
    iva: "IVA",
    total: "TOTAL",
    mostrarMetros: true,
    metros: "Metros totales",
  },
  orden: ["observaciones", "condiciones", "aceptacion"],
  observaciones: { mostrar: true, titulo: "Observaciones" },
  condiciones: {
    mostrar: true,
    titulo: "Condiciones",
    texto: [
      "Validez: hasta el {fecha_validez}, {validez} desde la fecha del presupuesto.",
      "Precios e importes de las líneas sin IVA. El IVA se suma en el resumen, por tipo.",
      "Para aceptarlo o resolver cualquier duda: {contacto}.",
    ].join("\n"),
  },
  aceptacion: {
    mostrar: true,
    titulo: "Aceptación del cliente",
    texto: "Conforme con el presupuesto {numero} y sus condiciones.",
    etiquetaFecha: "Fecha",
    etiquetaFirma: "Firma y sello",
  },
  pie: {
    texto: "{razon_social} · CIF {cif} · {direccion}",
    alineacion: "izquierda",
    tamano: 7,
    paginas: true,
  },
};

// ---------------------------------------------------------------------------
// Leer lo guardado: tolerante, siempre devuelve una plantilla completa
// ---------------------------------------------------------------------------

/** Un número dentro de [min, max]; si no lo es, el de por defecto. */
const num = (def: number, min: number, max: number) =>
  z.coerce
    .number()
    .refine((n) => Number.isFinite(n))
    .transform((n) => Math.min(max, Math.max(min, Math.round(n * 10) / 10)))
    .catch(def);

const bool = (def: boolean) => z.boolean().catch(def);
/** Un texto, hasta `max` caracteres; si no lo es, el de por defecto. */
const txt = (def: string, max = 200) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .catch(def);
const alin = (def: Alineacion) => z.enum(["izquierda", "centro", "derecha"]).catch(def);
const hex = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s === "" || /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s))
  .transform((s) => (s && !s.startsWith("#") ? `#${s}` : s).toLowerCase())
  .catch("");

const D = PLANTILLA_POR_DEFECTO;
const X = (def: number) => num(def, 0, ANCHO_PAGINA);
const Y = (def: number) => num(def, 0, ALTO_PAGINA);

/** Un objeto que, si falta o no es un objeto, se rellena entero con lo de por defecto. */
const objeto = <T extends z.ZodRawShape>(forma: T) =>
  z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}), z.object(forma));

const SECCIONES: SeccionFinal[] = ["observaciones", "condiciones", "aceptacion"];

export const esquemaPlantilla = objeto({
  version: z.literal(1).catch(1),
  colores: objeto({ principal: hex, acento: hex }),
  cabecera: objeto({
    alto: num(D.cabecera.alto, 20, 120),
    linea: bool(D.cabecera.linea),
    logo: objeto({
      mostrar: bool(D.cabecera.logo.mostrar),
      x: X(D.cabecera.logo.x),
      y: Y(D.cabecera.logo.y),
      ancho: num(D.cabecera.logo.ancho, 5, 180),
      alto: num(D.cabecera.logo.alto, 5, 100),
    }),
    nombre: objeto({
      mostrar: z.enum(["auto", "siempre", "nunca"]).catch(D.cabecera.nombre.mostrar),
      texto: txt(D.cabecera.nombre.texto, 80),
      x: X(D.cabecera.nombre.x),
      y: Y(D.cabecera.nombre.y),
      tamano: num(D.cabecera.nombre.tamano, 6, 40),
      alineacion: alin(D.cabecera.nombre.alineacion),
    }),
    titulo: objeto({
      mostrar: bool(D.cabecera.titulo.mostrar),
      texto: txt(D.cabecera.titulo.texto, 40),
      x: X(D.cabecera.titulo.x),
      y: Y(D.cabecera.titulo.y),
      tamano: num(D.cabecera.titulo.tamano, 6, 48),
      alineacion: alin(D.cabecera.titulo.alineacion),
    }),
    datos: objeto({
      mostrar: bool(D.cabecera.datos.mostrar),
      x: X(D.cabecera.datos.x),
      y: Y(D.cabecera.datos.y),
      ancho: num(D.cabecera.datos.ancho, 30, 180),
      etiquetaNumero: txt(D.cabecera.datos.etiquetaNumero, 30),
      etiquetaFecha: txt(D.cabecera.datos.etiquetaFecha, 30),
      etiquetaValidez: txt(D.cabecera.datos.etiquetaValidez, 30),
    }),
    texto: objeto({
      mostrar: bool(D.cabecera.texto.mostrar),
      texto: txt(D.cabecera.texto.texto, 400),
      x: X(D.cabecera.texto.x),
      y: Y(D.cabecera.texto.y),
      tamano: num(D.cabecera.texto.tamano, 6, 24),
      alineacion: alin(D.cabecera.texto.alineacion),
    }),
  }),
  partes: objeto({
    emisorPrimero: bool(D.partes.emisorPrimero),
    emisor: objeto({
      mostrar: bool(D.partes.emisor.mostrar),
      titulo: txt(D.partes.emisor.titulo, 40),
      razonSocial: bool(D.partes.emisor.razonSocial),
      cif: bool(D.partes.emisor.cif),
      direccion: bool(D.partes.emisor.direccion),
      email: bool(D.partes.emisor.email),
      telefono: bool(D.partes.emisor.telefono),
      web: bool(D.partes.emisor.web),
    }),
    cliente: objeto({
      mostrar: bool(D.partes.cliente.mostrar),
      titulo: txt(D.partes.cliente.titulo, 40),
      empresa: bool(D.partes.cliente.empresa),
      nif: bool(D.partes.cliente.nif),
      direccion: bool(D.partes.cliente.direccion),
      email: bool(D.partes.cliente.email),
      telefono: bool(D.partes.cliente.telefono),
    }),
  }),
  tabla: objeto({
    descripcion: txt(D.tabla.descripcion, 30),
    cantidad: txt(D.tabla.cantidad, 20),
    precio: txt(D.tabla.precio, 20),
    iva: txt(D.tabla.iva, 12),
    importe: txt(D.tabla.importe, 20),
    mostrarCantidad: bool(D.tabla.mostrarCantidad),
    mostrarPrecio: bool(D.tabla.mostrarPrecio),
    mostrarIva: bool(D.tabla.mostrarIva),
  }),
  resumen: objeto({
    base: txt(D.resumen.base, 30),
    iva: txt(D.resumen.iva, 20),
    total: txt(D.resumen.total, 20),
    mostrarMetros: bool(D.resumen.mostrarMetros),
    metros: txt(D.resumen.metros, 30),
  }),
  // Cada sección una vez, en el orden guardado; las que falten, al final en su orden de siempre.
  orden: z
    .array(z.unknown())
    .transform((a) => {
      const vistas = a.filter(
        (s, i): s is SeccionFinal => SECCIONES.includes(s as SeccionFinal) && a.indexOf(s) === i,
      );
      return [...vistas, ...SECCIONES.filter((s) => !vistas.includes(s))];
    })
    .catch([...D.orden]),
  observaciones: objeto({
    mostrar: bool(D.observaciones.mostrar),
    titulo: txt(D.observaciones.titulo, 40),
  }),
  condiciones: objeto({
    mostrar: bool(D.condiciones.mostrar),
    titulo: txt(D.condiciones.titulo, 40),
    texto: txt(D.condiciones.texto, 2000),
  }),
  aceptacion: objeto({
    mostrar: bool(D.aceptacion.mostrar),
    titulo: txt(D.aceptacion.titulo, 60),
    texto: txt(D.aceptacion.texto, 400),
    etiquetaFecha: txt(D.aceptacion.etiquetaFecha, 30),
    etiquetaFirma: txt(D.aceptacion.etiquetaFirma, 30),
  }),
  pie: objeto({
    texto: txt(D.pie.texto, 600),
    alineacion: alin(D.pie.alineacion),
    tamano: num(D.pie.tamano, 5, 12),
    paginas: bool(D.pie.paginas),
  }),
});

/**
 * La plantilla completa a partir de lo que haya guardado (o de nada). Nunca
 * falla: lo que no sirve se sustituye por lo de por defecto.
 */
export function normalizarPlantilla(guardada: unknown): PlantillaPresupuesto {
  const r = esquemaPlantilla.safeParse(guardada ?? {});
  return r.success ? (r.data as PlantillaPresupuesto) : structuredClone(PLANTILLA_POR_DEFECTO);
}

// ---------------------------------------------------------------------------
// Variables en los textos
// ---------------------------------------------------------------------------

/** Las variables que admiten los textos de la plantilla, con lo que significan. */
export const VARIABLES_PLANTILLA = {
  numero: "Número del presupuesto",
  fecha: "Fecha del presupuesto",
  fecha_validez: "Último día de validez",
  validez: "Días de validez («30 días»)",
  nombre_comercial: "Nombre comercial",
  razon_social: "Razón social",
  cif: "CIF",
  direccion: "Dirección fiscal, en una línea",
  email: "Correo de contacto",
  telefono: "Teléfono",
  web: "Web",
  contacto: "Correo y teléfono juntos",
} as const;

export type VariablePlantilla = keyof typeof VARIABLES_PLANTILLA;
export type ValoresPlantilla = Partial<Record<VariablePlantilla, string | null | undefined>>;

const VARIABLE = /\{([a-z_]+)\}/g;

/**
 * Rellena las variables de un texto de la plantilla.
 *
 * Lo que no se sabe no se inventa ni deja huecos raros: cada línea se parte en
 * trozos por « · », y un trozo con variables que han salido todas vacías se
 * quita (con su texto: «CIF {cif}» sin CIF desaparece entero). Si a una línea
 * no le queda nada, se quita la línea. Una variable que no existe se deja tal
 * cual, para que se vea al revisar la plantilla.
 */
export function rellenarTexto(plantilla: string, valores: ValoresPlantilla): string[] {
  const valor = (nombre: string): string | undefined =>
    nombre in VARIABLES_PLANTILLA
      ? (valores[nombre as VariablePlantilla] ?? "").toString().trim()
      : undefined;

  return plantilla
    .split(/\r?\n/)
    .map((linea) =>
      linea
        .split(" · ")
        .filter((trozo) => {
          const usadas = [...trozo.matchAll(VARIABLE)].map((m) => valor(m[1]));
          const conocidas = usadas.filter((v): v is string => v !== undefined);
          return conocidas.length === 0 || conocidas.some((v) => v !== "");
        })
        .map((trozo) => trozo.replace(VARIABLE, (m, n: string) => valor(n) ?? m))
        .join(" · ")
        .trim(),
    )
    .filter((linea) => linea !== "");
}

// ---------------------------------------------------------------------------
// La identidad que sale en el PDF
// ---------------------------------------------------------------------------

/**
 * El nombre comercial, el logo y el color que lleva el PDF: los de la
 * plantilla si los tiene; si no, los de la tienda (o los de la marca, en el
 * textil).
 */
export function resolverIdentidad(
  plantilla: PlantillaPresupuesto,
  logoPlantilla: string | null | undefined,
  base: {
    nombre: string | null | undefined;
    logo_url: string | null | undefined;
    color: string | null | undefined;
  },
): { nombre_comercial: string; logo_url: string | null; color: string | null } {
  return {
    nombre_comercial: plantilla.cabecera.nombre.texto.trim() || (base.nombre ?? "").trim(),
    logo_url: plantilla.cabecera.logo.mostrar
      ? logoPlantilla?.trim() || base.logo_url || null
      : null,
    color: plantilla.colores.principal || base.color || null,
  };
}
