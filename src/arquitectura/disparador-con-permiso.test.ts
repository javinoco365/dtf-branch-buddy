import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Un disparador de Radix con asChild (DropdownMenuTrigger, DialogTrigger,
// PopoverTrigger…) le pasa a su hijo el clic y la referencia. <SiPuede> no los
// reenvía, así que con él dentro el botón no hace nada: así dejaron de abrirse
// «Nuevo presupuesto» y «Nueva factura» (23-10-2026). El permiso va por fuera.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = path.join(dir, n);
    if (statSync(r).isDirectory()) return ficheros(r);
    return r.endsWith(".tsx") ? [r] : [];
  });
}

describe("disparadores con permiso", () => {
  it("ningún Trigger asChild envuelve a <SiPuede>", () => {
    const mal = ficheros(SRC).filter((f) =>
      /Trigger\s+asChild[^>]*>\s*<SiPuede\b/.test(readFileSync(f, "utf8")),
    );
    expect(mal.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
