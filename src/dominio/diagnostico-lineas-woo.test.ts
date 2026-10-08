import { describe, expect, it } from "vitest";
import { describirMetaWoo } from "./diagnostico-lineas-woo";

describe("describirMetaWoo", () => {
  it("una medida: enseña el valor, el número y qué es", () => {
    expect(describirMetaWoo({ key: "Longitud facturada por trabajo (m)", value: "1.753" })).toEqual(
      {
        clave: "Longitud facturada por trabajo (m)",
        etiqueta: null,
        tipo: "texto",
        numero: 1.753,
        propiedades: [],
        valor: "1.753",
        reconocido: "facturada",
      },
    );
  });

  it("una clave interna con etiqueta legible", () => {
    const d = describirMetaWoo({
      key: "_dtfb_len",
      display_key: "Longitud de hoja (m)",
      value: "1.75",
      display_value: "1.75",
    });
    expect(d).toMatchObject({ etiqueta: "Longitud de hoja (m)", reconocido: "hoja", numero: 1.75 });
  });

  it("un JSON o un objeto: solo los nombres de sus propiedades, sin valores", () => {
    const d = describirMetaWoo({
      key: "_dtfbuild_job",
      value: '{"sheet":{"width_cm":58,"length_cm":175.3},"files":["https://x/y.pdf"]}',
    });
    expect(d.tipo).toBe("texto");
    expect(d.propiedades).toEqual(["sheet.width_cm", "sheet.length_cm", "files.[0]"]);
    expect(d.valor).toBeNull();
    expect(d.numero).toBeNull();
    expect(describirMetaWoo({ key: "_x", value: { a: { b: 1 } } })).toMatchObject({
      tipo: "objeto",
      propiedades: ["a.b"],
    });
  });

  it("no enseña lo que no es una medida, ni enlaces aunque lo parezca", () => {
    expect(
      describirMetaWoo({ key: "Texto personalizado", value: "Feliz cumple, Ana" }).valor,
    ).toBeNull();
    expect(
      describirMetaWoo({ key: "Hoja 1 PDF", value: "https://tienda.es/wp-content/x.pdf" }).valor,
    ).toBeNull();
    expect(describirMetaWoo({ key: "ID del proyecto", value: "8LTBE" }).valor).toBeNull();
  });
});
