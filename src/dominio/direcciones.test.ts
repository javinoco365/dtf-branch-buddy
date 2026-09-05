import { describe, expect, it } from "vitest";
import { lineasDireccion, mismaDireccion, normalizarDireccion } from "./direcciones";

describe("normalizarDireccion", () => {
  it("devuelve null cuando no hay ningún dato", () => {
    // El caso que motiva el módulo: el formulario se abre, no se toca la
    // pestaña de direcciones y se guarda. Si esto devolviera {} en vez de null,
    // la columna quedaría NOT NULL con un objeto vacío dentro y el pedido
    // parecería tener dirección.
    expect(normalizarDireccion({})).toBeNull();
    expect(normalizarDireccion({ nombre: "", ciudad: "   ", pais: "" })).toBeNull();
  });

  it("devuelve null para lo que no es un objeto", () => {
    expect(normalizarDireccion(null)).toBeNull();
    expect(normalizarDireccion(undefined)).toBeNull();
    expect(normalizarDireccion("Calle Mayor 3")).toBeNull();
    expect(normalizarDireccion(42)).toBeNull();
  });

  it("recorta los espacios y quita los campos vacíos", () => {
    expect(
      normalizarDireccion({
        nombre: "  Talleres Pérez  ",
        empresa: "",
        direccion: "Avenida de Huelva 7, Local 4",
        codigo_postal: " 21450 ",
        ciudad: "Cartaya",
        provincia: "   ",
        pais: "España",
      }),
    ).toEqual({
      nombre: "Talleres Pérez",
      direccion: "Avenida de Huelva 7, Local 4",
      codigo_postal: "21450",
      ciudad: "Cartaya",
      pais: "España",
    });
  });

  it("se queda con un solo campo si es el único que hay", () => {
    expect(normalizarDireccion({ telefono: "600 123 456" })).toEqual({ telefono: "600 123 456" });
  });

  it("ignora las claves que no reconoce", () => {
    // Lo que se guarda en la columna es la forma documentada en la migración.
    // Si el formulario mandara de más, no debe acabar congelado en el pedido.
    expect(
      normalizarDireccion({ ciudad: "Huelva", nif: "B88931118", __proto__: "x", notas: "urgente" }),
    ).toEqual({ ciudad: "Huelva" });
  });

  it("ignora los valores que no son texto", () => {
    expect(normalizarDireccion({ ciudad: "Huelva", codigo_postal: 21450 })).toEqual({
      ciudad: "Huelva",
    });
  });
});

describe("lineasDireccion", () => {
  it("junta código postal y ciudad, y provincia con país", () => {
    expect(
      lineasDireccion({
        nombre: "Talleres Pérez",
        direccion: "Avenida de Huelva 7, Local 4",
        codigo_postal: "21450",
        ciudad: "Cartaya",
        provincia: "Huelva",
        pais: "España",
        telefono: "600 123 456",
      }),
    ).toEqual([
      "Talleres Pérez",
      "Avenida de Huelva 7, Local 4",
      "21450 Cartaya",
      "Huelva, España",
      "600 123 456",
    ]);
  });

  it("no deja líneas huecas cuando faltan campos", () => {
    expect(lineasDireccion({ nombre: "Ana", ciudad: "Sevilla" })).toEqual(["Ana", "Sevilla"]);
    expect(lineasDireccion({})).toEqual([]);
  });

  it("no incluye el correo: no va en una etiqueta de envío", () => {
    expect(lineasDireccion({ nombre: "Ana", email: "ana@example.com" })).toEqual(["Ana"]);
  });
});

describe("mismaDireccion", () => {
  it("compara lo que se imprimiría, no el objeto", () => {
    expect(
      mismaDireccion({ nombre: "Ana", ciudad: "Sevilla" }, { nombre: "Ana", ciudad: "Sevilla" }),
    ).toBe(true);
    // El correo no se imprime, así que no las diferencia.
    expect(
      mismaDireccion({ nombre: "Ana", email: "a@x.com" }, { nombre: "Ana", email: "b@x.com" }),
    ).toBe(true);
    expect(mismaDireccion({ nombre: "Ana" }, { nombre: "Luis" })).toBe(false);
  });

  it("dos direcciones ausentes no son «la misma»", () => {
    // Si no hay ninguna dirección, la pantalla no debe decir «la misma que la
    // de facturación»: debe decir que no hay dirección.
    expect(mismaDireccion(null, null)).toBe(false);
    expect(mismaDireccion({ nombre: "Ana" }, null)).toBe(false);
  });
});
