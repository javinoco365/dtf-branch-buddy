import { describe, expect, it } from "vitest";
import {
  esNivel,
  impedimentoAlta,
  impedimentoCambioUsuario,
  mensajeSinPermiso,
  ordenarUsuarios,
  permisosDe,
  puede,
  type UsuarioConNivel,
} from "./permisos";

describe("puede y permisosDe", () => {
  it("admin lo hace todo", () => {
    expect(permisosDe("admin")).toEqual({
      nivel: "admin",
      ver: true,
      escribir: true,
      borrar: true,
      gestionarUsuarios: true,
    });
  });

  it("editor crea y modifica, pero no borra ni gestiona usuarios", () => {
    expect(permisosDe("editor")).toEqual({
      nivel: "editor",
      ver: true,
      escribir: true,
      borrar: false,
      gestionarUsuarios: false,
    });
  });

  it("visor solo ve", () => {
    expect(permisosDe("visor")).toEqual({
      nivel: "visor",
      ver: true,
      escribir: false,
      borrar: false,
      gestionarUsuarios: false,
    });
  });

  it("sin nivel (o desactivado) no hace nada", () => {
    expect(permisosDe(null)).toEqual({
      nivel: null,
      ver: false,
      escribir: false,
      borrar: false,
      gestionarUsuarios: false,
    });
    expect(puede(null, "escribir")).toBe(false);
  });

  it("las mismas reglas que rol_exigir() en la base", () => {
    expect(puede("editor", "escribir")).toBe(true);
    expect(puede("editor", "borrar")).toBe(false);
    expect(puede("editor", "admin")).toBe(false);
    expect(puede("visor", "escribir")).toBe(false);
    expect(puede("admin", "admin")).toBe(true);
  });
});

describe("esNivel", () => {
  it("solo los tres niveles", () => {
    expect(esNivel("admin")).toBe(true);
    expect(esNivel("visor")).toBe(true);
    expect(esNivel("superadmin")).toBe(false);
    expect(esNivel(null)).toBe(false);
  });
});

describe("mensajeSinPermiso", () => {
  it("dice por qué no", () => {
    expect(mensajeSinPermiso("escribir", "visor")).toMatch(/solo permite ver/);
    expect(mensajeSinPermiso("borrar", "editor")).toBe("Solo un administrador puede borrar");
    expect(mensajeSinPermiso("admin", "editor")).toBe("Solo un administrador puede hacer esto");
    expect(mensajeSinPermiso("escribir", null)).toMatch(/desactivado/);
  });
});

describe("impedimentoCambioUsuario", () => {
  const ana: UsuarioConNivel = { id: "ana", nivel: "admin", activo: true };
  const eva: UsuarioConNivel = { id: "eva", nivel: "editor", activo: true };
  const vito: UsuarioConNivel = { id: "vito", nivel: "visor", activo: true };

  it("un admin cambia el nivel de otro", () => {
    expect(impedimentoCambioUsuario([ana, eva], "ana", "eva", { nivel: "visor" })).toBeNull();
    expect(impedimentoCambioUsuario([ana, vito], "ana", "vito", { activo: false })).toBeNull();
  });

  it("solo un admin activo gestiona usuarios", () => {
    expect(impedimentoCambioUsuario([ana, eva], "eva", "eva", { nivel: "admin" })).toBe(
      "Solo un administrador puede gestionar usuarios",
    );
    const anaDesactivada = { ...ana, activo: false };
    expect(impedimentoCambioUsuario([anaDesactivada, eva], "ana", "eva", { nivel: "visor" })).toBe(
      "Solo un administrador puede gestionar usuarios",
    );
  });

  it("nadie se desactiva a sí mismo", () => {
    const otro = { id: "otro", nivel: "admin" as const, activo: true };
    expect(impedimentoCambioUsuario([ana, otro], "ana", "ana", { activo: false })).toBe(
      "No puedes desactivarte a ti mismo",
    );
  });

  it("el último admin no se quita a sí mismo", () => {
    expect(impedimentoCambioUsuario([ana, eva], "ana", "ana", { nivel: "editor" })).toBe(
      "Tiene que quedar al menos un administrador activo",
    );
  });

  it("con otro admin activo, sí se puede bajar", () => {
    const otro = { id: "otro", nivel: "admin" as const, activo: true };
    expect(impedimentoCambioUsuario([ana, otro], "ana", "ana", { nivel: "editor" })).toBeNull();
  });

  it("un admin desactivado no cuenta como el que queda", () => {
    const otroDesactivado = { id: "otro", nivel: "admin" as const, activo: false };
    expect(impedimentoCambioUsuario([ana, otroDesactivado], "ana", "ana", { nivel: "visor" })).toBe(
      "Tiene que quedar al menos un administrador activo",
    );
  });

  it("el usuario tiene que existir", () => {
    expect(impedimentoCambioUsuario([ana], "ana", "nadie", { nivel: "visor" })).toBe(
      "Ese usuario no existe",
    );
  });
});

describe("impedimentoAlta", () => {
  const base = {
    email: "eva@dti.es",
    nombre: "Eva",
    password: "12345678",
    modo: "contrasena" as const,
  };

  it("completa", () => {
    expect(impedimentoAlta(base)).toBeNull();
    expect(impedimentoAlta({ ...base, password: "", modo: "enlace" })).toBeNull();
  });

  it("falta algo", () => {
    expect(impedimentoAlta({ ...base, nombre: "  " })).toBe("Falta el nombre");
    expect(impedimentoAlta({ ...base, email: "eva" })).toBe("El correo no es válido");
    expect(impedimentoAlta({ ...base, password: "corta" })).toMatch(/8 caracteres/);
  });
});

describe("ordenarUsuarios", () => {
  it("admins, editores, visores, sin nivel y desactivados al final; por nombre", () => {
    const lista = [
      { id: "1", nombre: "Zoe", nivel: "visor" as const, activo: true },
      { id: "2", nombre: "Bea", nivel: "admin" as const, activo: false },
      { id: "3", nombre: "Ana", nivel: "editor" as const, activo: true },
      { id: "4", nombre: "Íñigo", nivel: "admin" as const, activo: true },
      { id: "5", nombre: "Carla", nivel: null, activo: true },
    ];
    expect(ordenarUsuarios(lista).map((u) => u.nombre)).toEqual([
      "Íñigo",
      "Ana",
      "Zoe",
      "Carla",
      "Bea",
    ]);
  });
});
