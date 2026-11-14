import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorDeValidacion, errorLecturaParaPersonas, errorParaPersonas } from "./errores";

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

describe("errores de Supabase Auth", () => {
  it("credenciales incorrectas al entrar", () => {
    const r = errorParaPersonas("Invalid login credentials");
    expect(r.texto).toBe("El correo o la contraseña no son correctos.");
    expect(r.detalle).toBe("Invalid login credentials");
  });

  it("contraseña corta, con el número que pide", () => {
    expect(errorParaPersonas("Password should be at least 8 characters.").texto).toBe(
      "La contraseña es demasiado corta: tiene que tener al menos 8 caracteres.",
    );
  });

  it("contraseña débil o filtrada", () => {
    expect(
      errorParaPersonas(
        "Password is known to be weak and easy to guess, please choose a different one.",
      ).texto,
    ).toMatch(/demasiado fácil de adivinar/);
  });

  it("la misma contraseña que ya tenía", () => {
    expect(
      errorParaPersonas("New password should be different from the old password.").texto,
    ).toMatch(/distinta de la que ya tenías/);
  });

  it("demasiados intentos, con la espera", () => {
    expect(
      errorParaPersonas("For security purposes, you can only request this after 42 seconds.").texto,
    ).toBe("Por seguridad, espera 42 segundos antes de volver a intentarlo.");
    expect(errorParaPersonas("Email rate limit exceeded").texto).toMatch(/Demasiados intentos/);
  });

  it("enlace caducado y sesión ausente", () => {
    expect(errorParaPersonas("Email link is invalid or has expired").texto).toMatch(
      /enlace ha caducado/,
    );
    expect(errorParaPersonas("Auth session missing!").texto).toMatch(/sesión ha caducado/);
  });

  it("usuario ya registrado o desactivado", () => {
    expect(errorParaPersonas("User already registered").texto).toBe(
      "Ya hay un usuario con ese correo.",
    );
    expect(errorParaPersonas("User is banned").texto).toMatch(/desactivado/);
  });
});

describe("errores de PostgREST", () => {
  it("una función o tabla que aún no existe", () => {
    expect(
      errorParaPersonas("Could not find the function public.foo(_x) in the schema cache").texto,
    ).toBe("Esta parte aún no está activada. Avisa a Javier.");
    expect(errorParaPersonas('relation "public.bar" does not exist').texto).toMatch(
      /aún no está activada/,
    );
  });

  it("un aviso que nombra el fichero de la migración no lo enseña", () => {
    const m = "Falta aplicar la migración 20261027100000_pedidos_realizado.sql";
    expect(errorParaPersonas(m)).toEqual({
      texto: "Esta parte aún no está activada. Avisa a Javier.",
      detalle: m,
    });
  });

  it("no hay fila cuando se esperaba una", () => {
    expect(
      errorParaPersonas("JSON object requested, multiple (or no) rows returned").texto,
    ).toMatch(/No se ha encontrado/);
  });

  it("un texto demasiado largo", () => {
    expect(errorParaPersonas("value too long for type character varying(20)").texto).toMatch(
      /demasiado largo/,
    );
  });
});

describe("errores de validación (zod)", () => {
  function mensajeZod(esquema: z.ZodType, datos: unknown): string {
    const r = esquema.safeParse(datos);
    if (r.success) throw new Error("debería fallar");
    return r.error.message;
  }

  it("un texto obligatorio vacío: «Falta el nombre del cliente»", () => {
    const m = mensajeZod(z.object({ cliente_nombre: z.string().min(1) }), { cliente_nombre: "" });
    expect(errorParaPersonas(m)).toEqual({ texto: "Falta el nombre del cliente.", detalle: null });
  });

  it("un campo que no llega", () => {
    const m = mensajeZod(z.object({ fecha: z.string() }), {});
    expect(errorParaPersonas(m).texto).toBe("Falta la fecha.");
  });

  it("un correo mal escrito y una tienda sin elegir", () => {
    const m = mensajeZod(z.object({ email: z.string().email(), tienda_id: z.string().uuid() }), {
      email: "pepe",
      tienda_id: "",
    });
    expect(errorParaPersonas(m).texto).toBe(
      "El correo no es un correo válido. Falta elegir la tienda.",
    );
  });

  it("números fuera de rango, con la línea", () => {
    const m = mensajeZod(
      z.object({ lineas: z.array(z.object({ cantidad: z.number().positive() })) }),
      { lineas: [{ cantidad: 1 }, { cantidad: 0 }] },
    );
    expect(errorParaPersonas(m).texto).toBe("La cantidad (línea 2) tiene que ser mayor que 0.");
  });

  it("un mensaje propio del esquema se respeta", () => {
    const m = mensajeZod(z.object({ nombre: z.string().min(1, "Pon un nombre a la tienda") }), {
      nombre: "",
    });
    expect(errorParaPersonas(m).texto).toBe("Pon un nombre a la tienda");
  });

  it("un campo sin nombre conocido se dice tal cual, sin JSON", () => {
    const m = mensajeZod(z.object({ cuenta_bancaria: z.string().min(1) }), {});
    const r = errorParaPersonas(m);
    expect(r.texto).toBe("Falta el campo «cuenta bancaria».");
    expect(r.texto).not.toMatch(/[[\]{}]/);
  });

  it("muchos fallos: tres y el resto contados", () => {
    const m = mensajeZod(
      z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() }),
      {},
    );
    expect(errorDeValidacion(m)).toMatch(/Y 2 cosas más\.$/);
  });

  it("un texto con corchetes que no es de zod no se toca", () => {
    expect(errorDeValidacion("No se puede [ahora] mismo")).toBeNull();
    expect(errorParaPersonas("Revisa el pedido [12]").texto).toBe("Revisa el pedido [12]");
  });
});
