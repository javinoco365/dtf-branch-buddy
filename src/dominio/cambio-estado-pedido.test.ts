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
  it("los cambios internos no se confirman", () => {
    expect(efectosCambioEstado(manual, "imprimiendo")).toEqual({ confirmar: false, efectos: [] });
    expect(efectosCambioEstado(web, "en_produccion").confirmar).toBe(false);
  });

  it("enviado se confirma y dice a quién va el correo y que se marca en la web", () => {
    const r = efectosCambioEstado(web, "enviado");
    expect(r.confirmar).toBe(true);
    expect(r.efectos[0]).toContain("ana@ejemplo.es");
    expect(r.efectos.some((e) => e.includes("completado en la web"))).toBe(true);
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
    expect(r.efectos.some((e) => e.includes("cancelado en la web"))).toBe(true);
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
