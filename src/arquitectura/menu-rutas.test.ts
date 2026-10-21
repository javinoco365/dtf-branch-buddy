import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRADA_GESTIONAR_TIENDAS,
  MENU_PRINCIPAL,
  MENU_SISTEMA,
  SUBMENU_TEXTIL,
  SUBMENU_TIENDA,
} from "@/dominio/navegacion";

/**
 * Cada entrada del menú tiene que llevar a una pantalla que existe: un nombre
 * mal escrito aquí deja una entrada del menú que no abre nada.
 */
describe("el menú apunta a pantallas que existen", () => {
  const RAIZ = join(__dirname, "..", "routes");
  function rutasDeFicheros(dir: string, base = ""): string[] {
    const salida: string[] = [];
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        salida.push(...rutasDeFicheros(p, `${base}/${f}`));
      } else if (f.endsWith(".tsx")) {
        const nombre = f.replace(/\.tsx$/, "");
        if (nombre === "__root" || nombre === "route") continue;
        salida.push(nombre === "index" ? base || "/" : `${base}/${nombre}`);
      }
    }
    return salida;
  }
  const existentes = new Set(rutasDeFicheros(RAIZ));

  const todas = [
    ...MENU_PRINCIPAL.flatMap((s) => s.entradas),
    ...SUBMENU_TEXTIL,
    ...MENU_SISTEMA,
    ENTRADA_GESTIONAR_TIENDAS,
  ];
  it.each(todas.map((e) => [e.etiqueta, e.ruta]))("%s → %s", (_, ruta) => {
    expect(existentes.has(ruta)).toBe(true);
  });

  it.each(SUBMENU_TIENDA.map((s) => [s.etiqueta, s.segmento]))("tienda › %s", (_, segmento) => {
    expect(existentes.has(`/panel/tiendas/$tiendaId${segmento ? `/${segmento}` : ""}`)).toBe(true);
  });
});
