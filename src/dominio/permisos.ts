/**
 * Niveles de usuario y qué puede hacer cada uno.
 *
 *   admin   todo, incluida la gestión de usuarios.
 *   editor  ve todo, crea y modifica; no borra ni gestiona usuarios.
 *   visor   solo ve: no crea, no cambia, no borra.
 *
 * La seguridad de verdad está en la base (migraciones 20261031200000 a
 * 20261031200300): políticas de escritura, la guardia por sentencia y la
 * comprobación al principio de las funciones SECURITY DEFINER. Esto decide qué
 * botones se enseñan y qué comprueban las server functions antes de escribir,
 * con las mismas reglas.
 *
 * Lógica pura: ni red ni base de datos.
 */

export type Nivel = "admin" | "editor" | "visor";

/** De más a menos permisos. */
export const NIVELES: readonly Nivel[] = ["admin", "editor", "visor"];

/** Lo que exige una acción: lo mismo que rol_exigir() en la base. */
export type Accion = "escribir" | "borrar" | "admin";

export type Permisos = {
  nivel: Nivel | null;
  /** Ver datos. Lo decide la RLS de lectura; aquí, que tenga nivel. */
  ver: boolean;
  /** Crear y modificar (admin y editor). */
  escribir: boolean;
  /** Borrar entidades (solo admin). */
  borrar: boolean;
  /** Ajustes > Usuarios: crear, cambiar nivel, desactivar (solo admin). */
  gestionarUsuarios: boolean;
};

export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  admin: "Administrador",
  editor: "Editor",
  visor: "Solo lectura",
};

export const DESCRIPCION_NIVEL: Record<Nivel, string> = {
  admin: "Todo, incluida la gestión de usuarios.",
  editor: "Ve todo, crea y modifica. No borra ni gestiona usuarios.",
  visor: "Solo ve: no crea, no cambia ni borra nada.",
};

export function esNivel(valor: unknown): valor is Nivel {
  return valor === "admin" || valor === "editor" || valor === "visor";
}

/** Si un nivel (null = sin nivel o desactivado) puede hacer una acción. */
export function puede(nivel: Nivel | null, accion: Accion): boolean {
  if (nivel === "admin") return true;
  if (nivel === "editor") return accion === "escribir";
  return false;
}

export function permisosDe(nivel: Nivel | null): Permisos {
  return {
    nivel,
    ver: nivel !== null,
    escribir: puede(nivel, "escribir"),
    borrar: puede(nivel, "borrar"),
    gestionarUsuarios: puede(nivel, "admin"),
  };
}

/** El mismo texto que da la base (rol_exigir), para la pantalla y el servidor. */
export function mensajeSinPermiso(accion: Accion, nivel: Nivel | null): string {
  if (nivel === null) {
    return "Tu usuario no tiene nivel de acceso o está desactivado: no puede cambiar datos";
  }
  if (accion === "escribir") {
    return `Tu nivel (${ETIQUETA_NIVEL[nivel].toLowerCase()}) solo permite ver: no puedes crear ni modificar datos`;
  }
  if (accion === "borrar") return "Solo un administrador puede borrar";
  return "Solo un administrador puede hacer esto";
}

// ---------------------------------------------------------------------------
// Gestión de usuarios
// ---------------------------------------------------------------------------

export type UsuarioConNivel = {
  id: string;
  nivel: Nivel | null;
  activo: boolean;
};

export type CambioUsuario = { nivel?: Nivel; activo?: boolean };

/**
 * null si el cambio se puede hacer; si no, por qué. Las mismas reglas que
 * usuario_fijar_nivel() y el trigger del último admin en la base:
 *
 * - solo un admin activo cambia niveles;
 * - nadie se desactiva a sí mismo;
 * - siempre queda al menos un admin activo.
 */
export function impedimentoCambioUsuario(
  usuarios: readonly UsuarioConNivel[],
  actorId: string,
  objetivoId: string,
  cambio: CambioUsuario,
): string | null {
  const actor = usuarios.find((u) => u.id === actorId);
  if (!actor || !actor.activo || actor.nivel !== "admin") {
    return "Solo un administrador puede gestionar usuarios";
  }
  const objetivo = usuarios.find((u) => u.id === objetivoId);
  if (!objetivo) return "Ese usuario no existe";
  if (actorId === objetivoId && cambio.activo === false) {
    return "No puedes desactivarte a ti mismo";
  }

  const despues = usuarios.map((u) =>
    u.id === objetivoId
      ? {
          ...u,
          nivel: cambio.nivel ?? u.nivel,
          activo: cambio.activo ?? u.activo,
        }
      : u,
  );
  if (!despues.some((u) => u.nivel === "admin" && u.activo)) {
    return "Tiene que quedar al menos un administrador activo";
  }
  return null;
}

export type AltaUsuario = {
  email: string;
  nombre: string;
  /** Contraseña inicial; vacía si se manda un enlace de invitación. */
  password: string;
  modo: "contrasena" | "enlace";
};

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** null si el alta está completa; si no, qué falta. */
export function impedimentoAlta(alta: AltaUsuario): string | null {
  if (!alta.nombre.trim()) return "Falta el nombre";
  if (!CORREO.test(alta.email.trim())) return "El correo no es válido";
  if (alta.modo === "contrasena" && alta.password.length < 8) {
    return "La contraseña inicial necesita al menos 8 caracteres";
  }
  return null;
}

/** Admins primero, luego editores y visores; desactivados al final; por nombre. */
export function ordenarUsuarios<T extends UsuarioConNivel & { nombre: string }>(
  usuarios: readonly T[],
): T[] {
  const peso = (u: T) => (u.activo ? 0 : 10) + (u.nivel ? NIVELES.indexOf(u.nivel) : 3);
  return [...usuarios].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es"));
}
