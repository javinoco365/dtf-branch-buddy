import { describe, expect, it } from "vitest";
import { estadosDe, infoEstado, legible } from "./estados";

describe("infoEstado", () => {
  it("cada fase del pedido tiene su color: ya no van todas en gris", () => {
    expect(infoEstado("pedido", "pendiente").tono).toBe("neutro");
    expect(infoEstado("pedido", "en_produccion")).toEqual({
      etiqueta: "Procesando",
      tono: "en_curso",
    });
    expect(infoEstado("pedido", "imprimiendo").tono).toBe("en_curso");
    expect(infoEstado("pedido", "listo").tono).toBe("atencion");
    expect(infoEstado("pedido", "entregado")).toEqual({ etiqueta: "Completado", tono: "bien" });
    expect(infoEstado("pedido", "cancelado").tono).toBe("mal");
  });

  it("el textil sale en palabras, no con el valor de la base", () => {
    expect(infoEstado("pedido_textil", "en_produccion").etiqueta).toBe("En producción");
  });

  it("en una compra, lo que pide atención es lo que se debe", () => {
    expect(infoEstado("pago_compra", "pendiente")).toEqual({
      etiqueta: "Por pagar",
      tono: "atencion",
    });
    expect(infoEstado("compra", "registrada").tono).toBe("neutro");
  });

  it("una factura anulada no se pinta como un problema", () => {
    expect(infoEstado("factura", "anulada").tono).toBe("neutro");
    expect(infoEstado("factura", "vencida").tono).toBe("mal");
  });

  it("no distingue mayúsculas ni espacios", () => {
    expect(infoEstado("factura", " Pagada ").etiqueta).toBe("Pagada");
  });

  it("un estado desconocido sale legible y en gris, nunca crudo", () => {
    expect(infoEstado("pedido", "en_espera_cliente")).toEqual({
      etiqueta: "En espera cliente",
      tono: "neutro",
    });
    expect(infoEstado("pedido", null)).toEqual({ etiqueta: "—", tono: "neutro" });
  });
});

describe("estadosDe", () => {
  it("da los estados en su orden, para los desplegables", () => {
    expect(estadosDe("pedido_textil").map((e) => e.valor)).toEqual([
      "pendiente",
      "en_produccion",
      "listo",
      "enviado",
      "entregado",
      "cancelado",
    ]);
  });
});

describe("legible", () => {
  it("quita los guiones bajos y pone la mayúscula", () => {
    expect(legible("devolucion_proveedor")).toBe("Devolucion proveedor");
  });
});
