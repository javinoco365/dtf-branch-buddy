import { describe, expect, it } from "vitest";
import { errorLecturaParaPersonas, errorParaPersonas } from "./errores";

describe("errorParaPersonas", () => {
  it("los mensajes ya pensados para personas se dejan como están", () => {
    expect(errorParaPersonas("Tu nivel (visor) no permite borrar.")).toEqual({
      texto: "Tu nivel (visor) no permite borrar.",
      detalle: null,
    });
  });

  it("sin conexión", () => {
    const r = errorParaPersonas("TypeError: Failed to fetch");
    expect(r.texto).toMatch(/No hay conexión/);
    expect(r.detalle).toBe("TypeError: Failed to fetch");
  });

  it("la RLS dice que no hay permiso, en castellano", () => {
    expect(
      errorParaPersonas('new row violates row-level security policy for table "pedidos"').texto,
    ).toMatch(/No tienes permiso/);
  });

  it("un duplicado de Postgres", () => {
    expect(
      errorParaPersonas('duplicate key value violates unique constraint "clientes_email_key"')
        .texto,
    ).toBe("Ya existe uno igual: está repetido.");
  });

  it("la sesión caducada", () => {
    expect(errorParaPersonas("JWT expired").texto).toMatch(/sesión ha caducado/);
  });

  it("un número suelto en un mensaje en castellano no se confunde con un código", () => {
    const m = "No se encuentra el pedido 23505 ni el 503.";
    expect(errorParaPersonas(m)).toEqual({ texto: m, detalle: null });
  });

  it("sin mensaje, el texto por defecto", () => {
    expect(errorParaPersonas(undefined, "No se ha podido guardar").texto).toBe(
      "No se ha podido guardar",
    );
    expect(errorParaPersonas("  ").texto).toMatch(/No se ha podido completar/);
  });
});

describe("errorLecturaParaPersonas", () => {
  it("el lector sin configurar: alta a mano", () => {
    expect(
      errorLecturaParaPersonas("Falta el secreto facturas_key en el Vault de Supabase.").texto,
    ).toMatch(/de alta a mano/);
  });

  it("una lectura con forma rara: releer", () => {
    const r = errorLecturaParaPersonas(
      "La lectura no tiene la forma esperada: confianza está fuera de rango. (tras un reintento)",
    );
    expect(r.texto).toMatch(/incompleta/);
    expect(r.detalle).toMatch(/fuera de rango/);
  });

  it("el lector respondió con error", () => {
    expect(
      errorLecturaParaPersonas("El lector de facturas ha respondido 400. (tras un reintento)")
        .texto,
    ).toMatch(/no ha podido con este fichero/);
  });
});
