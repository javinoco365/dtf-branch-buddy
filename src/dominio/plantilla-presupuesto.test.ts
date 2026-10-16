import { describe, expect, it } from "vitest";
import {
  PLANTILLA_POR_DEFECTO,
  ambitoDeClave,
  claveAmbito,
  normalizarPlantilla,
  rellenarTexto,
  resolverIdentidad,
} from "./plantilla-presupuesto";

describe("normalizarPlantilla", () => {
  it("sin nada guardado, la de por defecto", () => {
    expect(normalizarPlantilla(null)).toEqual(PLANTILLA_POR_DEFECTO);
    expect(normalizarPlantilla(undefined)).toEqual(PLANTILLA_POR_DEFECTO);
    expect(normalizarPlantilla("basura")).toEqual(PLANTILLA_POR_DEFECTO);
  });

  it("lo guardado manda; lo que falta sale de la de por defecto", () => {
    const p = normalizarPlantilla({
      cabecera: { titulo: { texto: "OFERTA", x: 100 } },
      pie: { texto: "Mi pie" },
    });
    expect(p.cabecera.titulo.texto).toBe("OFERTA");
    expect(p.cabecera.titulo.x).toBe(100);
    expect(p.cabecera.titulo.tamano).toBe(PLANTILLA_POR_DEFECTO.cabecera.titulo.tamano);
    expect(p.cabecera.logo).toEqual(PLANTILLA_POR_DEFECTO.cabecera.logo);
    expect(p.pie.texto).toBe("Mi pie");
    expect(p.tabla).toEqual(PLANTILLA_POR_DEFECTO.tabla);
  });

  it("una posición fuera de la página se recorta a la página; un valor roto vuelve al de por defecto", () => {
    const p = normalizarPlantilla({
      cabecera: { logo: { x: -40, y: 900, ancho: "60", alto: "nada" }, alineacion: 3 },
    });
    expect(p.cabecera.logo.x).toBe(0);
    expect(p.cabecera.logo.y).toBe(297);
    expect(p.cabecera.logo.ancho).toBe(60);
    expect(p.cabecera.logo.alto).toBe(PLANTILLA_POR_DEFECTO.cabecera.logo.alto);
  });

  it("colores: solo hexadecimales; sin almohadilla se le pone", () => {
    expect(
      normalizarPlantilla({ colores: { principal: "2A2260", acento: "rojo" } }).colores,
    ).toEqual({
      principal: "#2a2260",
      acento: "",
    });
  });

  it("el orden tiene cada sección una vez; las que faltan, al final", () => {
    expect(normalizarPlantilla({ orden: ["aceptacion", "aceptacion", "x"] }).orden).toEqual([
      "aceptacion",
      "observaciones",
      "condiciones",
    ]);
  });

  it("los textos se cortan a su largo máximo", () => {
    expect(
      normalizarPlantilla({ cabecera: { titulo: { texto: "A".repeat(100) } } }).cabecera.titulo
        .texto,
    ).toHaveLength(40);
  });
});

describe("rellenarTexto", () => {
  const valores = {
    numero: "PRES-DTFC-2026-0001",
    razon_social: "RONOCA DESARROLLOS S.L.",
    cif: "B21000000",
    direccion: "Calle Mayor 1, 21001 Huelva",
    email: "info@dtfculture.com",
    telefono: "",
    contacto: "info@dtfculture.com",
  };

  it("rellena las variables", () => {
    expect(rellenarTexto("{razon_social} · CIF {cif} · {direccion}", valores)).toEqual([
      "RONOCA DESARROLLOS S.L. · CIF B21000000 · Calle Mayor 1, 21001 Huelva",
    ]);
  });

  it("un trozo con variables vacías se quita entero; una línea vacía también", () => {
    expect(
      rellenarTexto("{razon_social} · Tel. {telefono}\nTel. {telefono}\nFijo", valores),
    ).toEqual(["RONOCA DESARROLLOS S.L.", "Fijo"]);
    expect(rellenarTexto("{razon_social} · CIF {cif}", { razon_social: "X" })).toEqual(["X"]);
  });

  it("una variable que no existe se deja a la vista", () => {
    expect(rellenarTexto("Hola {iban}", valores)).toEqual(["Hola {iban}"]);
  });

  it("la de condiciones por defecto sin contacto no deja la frase colgando", () => {
    const lineas = rellenarTexto(PLANTILLA_POR_DEFECTO.condiciones.texto, {
      fecha_validez: "15/11/2026",
      validez: "30 días",
    });
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toBe("Validez: hasta el 15/11/2026, 30 días desde la fecha del presupuesto.");
  });
});

describe("resolverIdentidad", () => {
  const base = { nombre: "DTF Culture", logo_url: "https://x/tienda.png", color: "#123456" };

  it("sin nada en la plantilla, lo de la tienda", () => {
    expect(resolverIdentidad(PLANTILLA_POR_DEFECTO, null, base)).toEqual({
      nombre_comercial: "DTF Culture",
      logo_url: "https://x/tienda.png",
      color: "#123456",
    });
  });

  it("lo de la plantilla manda; sin logo, sin logo", () => {
    const p = normalizarPlantilla({
      cabecera: { nombre: { texto: " DTI Culture " } },
      colores: { principal: "#2a2260" },
    });
    expect(resolverIdentidad(p, "https://x/propio.png", base)).toEqual({
      nombre_comercial: "DTI Culture",
      logo_url: "https://x/propio.png",
      color: "#2a2260",
    });
    const sinLogo = normalizarPlantilla({ cabecera: { logo: { mostrar: false } } });
    expect(resolverIdentidad(sinLogo, "https://x/propio.png", base).logo_url).toBeNull();
  });
});

describe("ámbitos", () => {
  it("ida y vuelta", () => {
    const t = { ambito: "tienda" as const, tiendaId: "00000000-0000-4000-8000-0000000000a1" };
    expect(ambitoDeClave(claveAmbito(t))).toEqual(t);
    expect(ambitoDeClave("textil")).toEqual({ ambito: "textil" });
    expect(ambitoDeClave("otra")).toBeNull();
  });
});
