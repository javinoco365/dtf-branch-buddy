import { describe, expect, it } from "vitest";
import { etiquetaPrimerPedido, textoMotivos, type ResumenPrimerPedido } from "./primer-pedido";

const base: ResumenPrimerPedido = {
  tiene_datos: true,
  cancelado: false,
  fuertes: 0,
  solo_nombre: 0,
  decision: null,
};

describe("etiquetaPrimerPedido", () => {
  it("sin pedidos anteriores que coincidan: primer pedido", () => {
    expect(etiquetaPrimerPedido(base)).toEqual({ tipo: "primero", decidido: false, parecidos: 0 });
  });

  it("con una coincidencia fuerte anterior: ya era cliente, sin etiqueta", () => {
    expect(etiquetaPrimerPedido({ ...base, fuertes: 1 })).toBeNull();
    expect(etiquetaPrimerPedido({ ...base, fuertes: 2, solo_nombre: 3 })).toBeNull();
  });

  it("solo coincide el nombre: dudoso, con cuántos se parece", () => {
    expect(etiquetaPrimerPedido({ ...base, solo_nombre: 2 })).toEqual({
      tipo: "dudoso",
      decidido: false,
      parecidos: 2,
    });
  });

  it("lo que decide una persona manda sobre la regla", () => {
    expect(etiquetaPrimerPedido({ ...base, solo_nombre: 2, decision: "nuevo" })).toEqual({
      tipo: "primero",
      decidido: true,
      parecidos: 2,
    });
    expect(etiquetaPrimerPedido({ ...base, decision: "repite" })).toBeNull();
    // Aunque la regla vea una coincidencia fuerte, si alguien dijo que es nuevo, es nuevo.
    expect(etiquetaPrimerPedido({ ...base, fuertes: 1, decision: "nuevo" })?.tipo).toBe("primero");
  });

  it("cancelado, sin datos o sin resumen: sin etiqueta", () => {
    expect(etiquetaPrimerPedido({ ...base, cancelado: true })).toBeNull();
    expect(etiquetaPrimerPedido({ ...base, tiene_datos: false })).toBeNull();
    expect(etiquetaPrimerPedido(undefined)).toBeNull();
    expect(etiquetaPrimerPedido(null)).toBeNull();
  });
});

describe("textoMotivos", () => {
  it("une los motivos en una frase", () => {
    expect(textoMotivos(["nombre"])).toBe("mismo nombre");
    expect(textoMotivos(["nombre", "direccion"])).toBe("mismo nombre y misma dirección");
    expect(textoMotivos(["email", "telefono", "nombre"])).toBe(
      "mismo email, mismo teléfono y mismo nombre",
    );
  });

  it("ignora lo que no conoce y no rompe sin motivos", () => {
    expect(textoMotivos(["otro", "nif"])).toBe("mismo NIF");
    expect(textoMotivos([])).toBe("");
  });
});
