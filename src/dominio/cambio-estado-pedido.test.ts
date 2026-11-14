import { describe, expect, it } from "vitest";
import {
  consecuenciasBorrarPedido,
  efectosCambioEstado,
  resumenCambioEstado,
} from "./cambio-estado-pedido";

describe("consecuenciasBorrarPedido", () => {
  const base = { lineas: 2, cobros: [], conSeguimiento: false, documento: null, esDeLaWeb: false };

  it("dice cuántas líneas se van", () => {
    const r = consecuenciasBorrarPedido(base);
    expect(r.impedimento).toBeNull();
    expect(r.consecuencias[0]).toBe("Sus 2 líneas.");
    expect(consecuenciasBorrarPedido({ ...base, lineas: 1 }).consecuencias[0]).toBe("Su línea.");
  });

  it("la factura se queda emitida; el ticket, emitido", () => {
    const de = (documento: string) =>
      consecuenciasBorrarPedido({ ...base, documento }).consecuencias.join(" ");
    expect(de("La factura F-3")).toContain("La factura F-3 no se borra: se queda emitida,");
    expect(de("El ticket T-1")).toContain("El ticket T-1 no se borra: se queda emitido,");
  });

  it("los cobros a mano lo impiden", () => {
    const r = consecuenciasBorrarPedido({ ...base, cobros: [{ automatico: false }] });
    expect(r.impedimento).toContain("1 cobro registrado");
  });

  it("los automáticos, el seguimiento, el documento y la web se nombran", () => {
    const r = consecuenciasBorrarPedido({
      ...base,
      cobros: [{ automatico: true }],
      conSeguimiento: true,
      documento: "El ticket T-1",
      esDeLaWeb: true,
    });
    const todo = r.consecuencias.join(" ");
    expect(todo).toContain("1 cobro automático");
    expect(todo).toContain("seguimiento");
    expect(todo).toContain("El ticket T-1");
    expect(todo).toContain("En la web sigue existiendo");
  });
});

const manual = { estado: "listo", esDeLaWeb: false, clienteEmail: "ana@ejemplo.es" };
const web = { ...manual, esDeLaWeb: true };

describe("efectosCambioEstado", () => {
  it("los cambios internos de un pedido manual no se confirman", () => {
    expect(efectosCambioEstado(manual, "imprimiendo")).toEqual({ confirmar: false, efectos: [] });
  });

  it("cualquier cambio de un pedido de la web se confirma: se cambia allí y puede avisar", () => {
    for (const nuevo of ["pendiente", "en_produccion", "imprimiendo", "entregado"]) {
      const r = efectosCambioEstado(web, nuevo);
      expect([nuevo, r.confirmar]).toEqual([nuevo, true]);
      expect(r.efectos.join(" ")).toMatch(/cambiará también en la web.*WooCommerce puede avisar/);
    }
    expect(efectosCambioEstado(web, "pendiente").efectos[0]).toContain("«en espera»");
  });

  it("reabrir un cancelado se confirma, también en un pedido manual", () => {
    const cancelado = { ...manual, estado: "cancelado" };
    const r = efectosCambioEstado(cancelado, "en_produccion");
    expect(r.confirmar).toBe(true);
    expect(r.efectos).toContain("El pedido volverá a contar en ventas y producción.");
  });

  it("enviado se confirma y dice a quién va el correo y que se marca en la web", () => {
    const r = efectosCambioEstado(web, "enviado");
    expect(r.confirmar).toBe(true);
    expect(r.efectos[0]).toContain("ana@ejemplo.es");
    expect(r.efectos.some((e) => e.includes("en la web, a «completado»"))).toBe(true);
  });

  it("enviado sin email lo dice en vez de prometer un correo", () => {
    const r = efectosCambioEstado({ ...manual, clienteEmail: null }, "enviado");
    expect(r.confirmar).toBe(true);
    expect(r.efectos[0]).toContain("no tiene email");
    expect(r.efectos.some((e) => e.includes("web"))).toBe(false);
  });

  it("cancelado se confirma siempre, y en la web dice que se cancela allí", () => {
    expect(efectosCambioEstado(manual, "cancelado").confirmar).toBe(true);
    const r = efectosCambioEstado(web, "cancelado");
    expect(r.efectos.some((e) => e.includes("en la web, a «cancelado»"))).toBe(true);
  });

  it("completado en un pedido de la web se confirma: la web avisa al cliente", () => {
    expect(efectosCambioEstado(web, "entregado").confirmar).toBe(true);
    expect(efectosCambioEstado(manual, "entregado").confirmar).toBe(false);
  });

  it("el mismo estado o uno desconocido no hace nada", () => {
    expect(efectosCambioEstado(manual, "listo").confirmar).toBe(false);
    expect(efectosCambioEstado(manual, "inventado").confirmar).toBe(false);
  });
});

describe("resumenCambioEstado", () => {
  it("todo bien: lo dice, con el correo y la web", () => {
    const r = resumenCambioEstado(
      "Enviado",
      { woo_synced: true, woo_aplica: true, aviso: { estado: "enviado", destinatario: "a@b.es" } },
      true,
    );
    expect(r.tono).toBe("bien");
    expect(r.detalles).toEqual(["Correo enviado a a@b.es.", "Actualizado también en la web."]);
  });

  it("si el correo falla, no dice «actualizado» a secas", () => {
    const r = resumenCambioEstado(
      "Enviado",
      { woo_synced: true, aviso: { estado: "fallido", motivo: "SMTP caído" } },
      false,
    );
    expect(r.tono).toBe("aviso");
    expect(r.detalles[0]).toContain("SMTP caído");
  });

  it("si la web no se actualizó, lo dice", () => {
    const r = resumenCambioEstado("Listo", { woo_synced: false, aviso: null }, true);
    expect(r.tono).toBe("aviso");
    expect(r.detalles[0]).toContain("web");
  });

  it("un pedido manual no habla de la web", () => {
    const r = resumenCambioEstado("Listo", { woo_synced: false, aviso: null }, false);
    expect(r).toEqual({ tono: "bien", titulo: "Pedido marcado como Listo", detalles: [] });
  });

  it("el servidor manda sobre si la web aplica", () => {
    const r = resumenCambioEstado(
      "Listo",
      { woo_synced: false, woo_aplica: false, aviso: null },
      true,
    );
    expect(r.tono).toBe("bien");
  });
});
