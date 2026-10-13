import { describe, expect, it } from "vitest";
import {
  coincideBusqueda,
  coincideOrigen,
  etiquetaOrigen,
  filtrarClientes,
  normalizarNif,
  normalizarTexto,
} from "./clientes";

const charanga = {
  nombre: "Peña La Charanga",
  apodo: "Charanga",
  email: "Charanga@Example.com",
  nif: "G-12.345.678",
  telefono: "600 123 456",
  tienda_id: null,
  origen: "textil",
};
const nautico = {
  nombre: "Club Náutico S.L.",
  apodo: null,
  email: "club@example.com",
  nif: "B87654321",
  telefono: null,
  tienda_id: "t1",
  origen: "tienda",
};
const general = { nombre: "Talleres Pérez", tienda_id: null, origen: "general" };

describe("normalizarTexto", () => {
  it("quita tildes y mayúsculas", () => {
    expect(normalizarTexto("  Peña NÁUTICA ")).toBe("pena nautica");
  });

  it("nulo es cadena vacía", () => {
    expect(normalizarTexto(null)).toBe("");
  });
});

describe("normalizarNif", () => {
  it("como lo compara la base: sin separadores y en mayúsculas", () => {
    expect(normalizarNif("g-12.345 678")).toBe("G12345678");
  });
});

describe("coincideBusqueda", () => {
  it("sin texto, todo coincide", () => {
    expect(coincideBusqueda(charanga, "  ")).toBe(true);
  });

  it("encuentra sin tildes: «nautico» da con «Náutico»", () => {
    expect(coincideBusqueda(nautico, "nautico")).toBe(true);
  });

  it("encuentra por apodo, correo y teléfono", () => {
    expect(coincideBusqueda(charanga, "charanga")).toBe(true);
    expect(coincideBusqueda(charanga, "charanga@example")).toBe(true);
    expect(coincideBusqueda(charanga, "600 123")).toBe(true);
  });

  it("encuentra el NIF se escriba como se escriba", () => {
    expect(coincideBusqueda(charanga, "g12345678")).toBe(true);
    expect(coincideBusqueda(nautico, "B-8765")).toBe(true);
  });

  it("no encuentra lo que no está", () => {
    expect(coincideBusqueda(nautico, "charanga")).toBe(false);
  });
});

describe("coincideOrigen", () => {
  it("todos deja pasar a todos", () => {
    expect([charanga, nautico, general].every((c) => coincideOrigen(c, "todos"))).toBe(true);
  });

  it("textil solo los dados de alta en el textil", () => {
    expect(coincideOrigen(charanga, "textil")).toBe(true);
    expect(coincideOrigen(nautico, "textil")).toBe(false);
  });

  it("una tienda, solo los dados de alta en esa tienda", () => {
    expect(coincideOrigen(nautico, "tienda:t1")).toBe(true);
    expect(coincideOrigen(nautico, "tienda:t2")).toBe(false);
    expect(coincideOrigen(charanga, "tienda:t1")).toBe(false);
  });

  it("general, los de la pantalla general", () => {
    expect(coincideOrigen(general, "general")).toBe(true);
    expect(coincideOrigen(charanga, "general")).toBe(false);
  });
});

describe("filtrarClientes", () => {
  it("combina origen y texto", () => {
    const r = filtrarClientes([charanga, nautico, general], { texto: "s.l", origen: "todos" });
    expect(r.map((c) => c.nombre)).toEqual(["Club Náutico S.L."]);
    expect(filtrarClientes([charanga, nautico, general], { texto: "", origen: "textil" })).toEqual([
      charanga,
    ]);
  });
});

describe("etiquetaOrigen", () => {
  const nombre = (id: string) => (id === "t1" ? "DTF Culture" : undefined);

  it("el nombre de la tienda, textil o general", () => {
    expect(etiquetaOrigen(nautico, nombre)).toBe("DTF Culture");
    expect(etiquetaOrigen(charanga, nombre)).toBe("Textil");
    expect(etiquetaOrigen(general, nombre)).toBe("General");
  });

  it("si la tienda se borró, lo dice en vez de dejar el hueco", () => {
    expect(etiquetaOrigen({ nombre: "X", origen: "tienda", tienda_id: null }, nombre)).toBe(
      "Tienda borrada",
    );
  });
});
