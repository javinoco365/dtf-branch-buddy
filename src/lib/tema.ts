/**
 * Modo claro y modo oscuro.
 *
 * Tailwind aquí distingue el tema por la clase `dark` en el `<html>`
 * (`@custom-variant dark (&:is(.dark *))` en styles.css), así que todo esto se
 * reduce a poner o quitar esa clase.
 *
 * ## Los tres estados, y por qué no son dos
 *
 * «Sistema» no es lo mismo que «claro». Si alguien tiene el ordenador en
 * oscuro y la aplicación se queda fija en claro, cada vez que cambie el
 * ordenador tendrá que volver aquí a cambiarlo. Con «sistema» la aplicación
 * sigue al ordenador, incluso si cambia con la pantalla abierta.
 *
 * ## Por qué esto no vive dentro de un componente de React
 *
 * Porque la clase hay que ponerla ANTES de que se pinte nada. Si se pusiera al
 * montar el componente, la primera pintura sería en claro y el usuario vería un
 * fogonazo blanco antes de que la pantalla se ponga oscura. El guion de
 * `__root.tsx` llama a `claseDelTema()` en el `<head>`, y esto solo se encarga
 * de mantenerlo desde ese momento.
 */

export type Tema = "claro" | "oscuro" | "sistema";

export const CLAVE_TEMA = "dtfculture:tema";

/** Lo guardado, o «sistema» si no hay nada o el navegador no deja leerlo. */
export function leerTema(): Tema {
  if (typeof localStorage === "undefined") return "sistema";
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return v === "claro" || v === "oscuro" ? v : "sistema";
  } catch {
    // Navegación privada o cookies bloqueadas: no es un error, es que no hay
    // preferencia guardada.
    return "sistema";
  }
}

/** Si con este tema toca pintar en oscuro. */
export function esOscuro(tema: Tema): boolean {
  if (tema === "oscuro") return true;
  if (tema === "claro") return false;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Pone o quita la clase, y deja dicho al navegador de qué color son sus barras. */
export function aplicarTema(tema: Tema) {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  const oscuro = esOscuro(tema);
  raiz.classList.toggle("dark", oscuro);
  // Sin esto, los controles del propio navegador —las barras de desplazamiento,
  // los desplegables de fecha— se quedan en claro dentro de una aplicación
  // oscura.
  raiz.style.colorScheme = oscuro ? "dark" : "light";
}

export function guardarTema(tema: Tema) {
  aplicarTema(tema);
  try {
    if (tema === "sistema") localStorage.removeItem(CLAVE_TEMA);
    else localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Se queda aplicado en esta pestaña aunque no se pueda recordar.
  }
}
