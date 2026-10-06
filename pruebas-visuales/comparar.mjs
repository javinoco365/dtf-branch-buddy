// Compara dos tandas de capturas, píxel a píxel.
//
// Uso:
//   node pruebas-visuales/comparar.mjs <antes> <despues> [--solo escritorio|movil]
//                                      [--umbral 4]
//
// Para cada captura que esté en las dos carpetas dice si es idéntica o cuántos
// píxeles cambian, y en ese caso deja al lado una imagen «<nombre>.diff.png»
// con los cambios en rojo. Sale con código 1 si cambia alguna: así sirve para
// comprobar que un arreglo del móvil no ha tocado el ordenador.
//
// Las imágenes se decodifican con el propio Chromium de Playwright, que ya hace
// falta para capturar: no añade dependencias.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const args = process.argv.slice(2);
const [antes, despues] = args;
if (!antes || !despues) {
  console.error("Uso: comparar.mjs <antes> <despues> [--solo escritorio|movil]");
  process.exit(2);
}
const opcion = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const SOLO = opcion("--solo");
// Diferencia máxima, por canal y de 0 a 255, que se toma por ruido. Chromium
// alisa a veces el borde de un menú con uno a tres tonos de diferencia entre
// dos pasadas del mismo código; eso no se ve y no es un cambio.
const UMBRAL = Number(opcion("--umbral") ?? 4);

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const pagina = await navegador.newPage();

// Decodifica las dos imágenes en un canvas y cuenta los píxeles distintos.
// Devuelve el PNG de diferencias en base64 si hay alguna.
async function diferencias(a, b) {
  return pagina.evaluate(
    async ([a64, b64, umbral]) => {
      const cargar = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        return img;
      };
      const [ia, ib] = await Promise.all([cargar(a64), cargar(b64)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixeles = (img) => {
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const pa = pixeles(ia);
      const pb = pixeles(ib);
      const salida = new ImageData(w, h);
      let distintos = 0;
      let maxDelta = 0;
      let x0 = w,
        y0 = h,
        x1 = -1,
        y1 = -1;
      for (let k = 0; k < pa.length; k += 4) {
        const delta = Math.max(
          Math.abs(pa[k] - pb[k]),
          Math.abs(pa[k + 1] - pb[k + 1]),
          Math.abs(pa[k + 2] - pb[k + 2]),
          Math.abs(pa[k + 3] - pb[k + 3]),
        );
        maxDelta = Math.max(maxDelta, delta);
        const igual = delta <= umbral;
        if (igual) {
          // Lo que no cambia, en gris claro para situarse.
          const g = 255 - (255 - (pa[k] + pa[k + 1] + pa[k + 2]) / 3) * 0.25;
          salida.data.set([g, g, g, 255], k);
        } else {
          distintos++;
          const px = (k / 4) % w;
          const py = Math.floor(k / 4 / w);
          x0 = Math.min(x0, px);
          y0 = Math.min(y0, py);
          x1 = Math.max(x1, px);
          y1 = Math.max(y1, py);
          salida.data.set([230, 0, 0, 255], k);
        }
      }
      const tamano = ia.width === ib.width && ia.height === ib.height;
      if (distintos === 0 && tamano) return { distintos: 0, tamano };
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").putImageData(salida, 0, 0);
      const blob = await c.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let k = 0; k < buf.length; k += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
      }
      return {
        distintos,
        tamano,
        dims: `${ia.width}x${ia.height} → ${ib.width}x${ib.height}`,
        maxDelta,
        zona: x1 < 0 ? "" : `x ${x0}–${x1}, y ${y0}–${y1}`,
        png: btoa(bin),
      };
    },
    [a.toString("base64"), b.toString("base64"), UMBRAL],
  );
}

let cambiadas = 0;
let comparadas = 0;
let faltan = 0;
for (const tamano of ["escritorio", "movil"]) {
  if (SOLO && SOLO !== tamano) continue;
  const da = join(antes, tamano);
  const db = join(despues, tamano);
  if (!existsSync(da) || !existsSync(db)) continue;
  const nombres = readdirSync(da).filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"));
  for (const nombre of nombres.sort()) {
    const fb = join(db, nombre);
    if (!existsSync(fb)) {
      faltan++;
      continue;
    }
    comparadas++;
    const a = readFileSync(join(da, nombre));
    const b = readFileSync(fb);
    if (a.equals(b)) {
      console.log(`=  ${tamano}/${nombre}`);
      continue;
    }
    const r = await diferencias(a, b);
    if (r.distintos === 0 && r.tamano) {
      console.log(`=  ${tamano}/${nombre}`);
      continue;
    }
    cambiadas++;
    const salida = fb.replace(/\.png$/, ".diff.png");
    writeFileSync(salida, Buffer.from(r.png, "base64"));
    const extra = r.tamano ? "" : ` (tamaño ${r.dims})`;
    console.log(
      `≠  ${tamano}/${nombre}: ${r.distintos} píxeles distintos (Δ máx ${r.maxDelta}) en ${r.zona}${extra} → ${salida}`,
    );
  }
}

await navegador.close();
const sinPareja = faltan ? ` (${faltan} sin captura en ${despues})` : "";
console.log(`\n${comparadas} comparadas, ${cambiadas} con cambios${sinPareja}.`);
process.exit(cambiadas > 0 ? 1 : 0);
