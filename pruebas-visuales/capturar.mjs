// Capturas de todas las pantallas, a tamaño ordenador y a tamaño móvil.
//
// Uso:
//   node pruebas-visuales/capturar.mjs <carpeta> [--base http://localhost:8090]
//                                      [--solo escritorio|movil] [--rutas a,b]
//
// Necesita la aplicación arrancada contra el Supabase de prueba (ver
// pruebas-visuales/LEEME.md). La fecha del navegador se fija para que lo que
// depende de «hoy» salga siempre igual.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sesion, TIENDA } from "./datos.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const args = process.argv.slice(2);
const carpeta = args[0];
if (!carpeta) {
  console.error("Falta la carpeta de salida");
  process.exit(1);
}
const opcion = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = opcion("--base") ?? "http://localhost:8090";
const SOLO = opcion("--solo");
const FILTRO = opcion("--rutas")?.split(",");

export const RUTAS = {
  inicio: "/panel",
  gerencia: "/panel/gerencia",
  "gerencia-ventas": "/panel/gerencia?pestana=ventas",
  "gerencia-tesoreria": "/panel/gerencia?pestana=tesoreria",
  pedidos: "/panel/pedidos",
  consolidada: "/panel/facturacion-global",
  cobros: "/panel/cobros",
  clientes: "/panel/clientes",
  productos: "/panel/productos",
  caja: "/panel/caja",
  inversion: "/panel/inversion",
  conciliacion: "/panel/conciliacion",
  configuracion: "/panel/configuracion",
  "configuracion-empresa": "/panel/configuracion-empresa",
  "configuracion-caja": "/panel/configuracion-caja",
  usuarios: "/panel/usuarios",
  tiendas: "/panel/tiendas",
  "tienda-inicio": `/panel/tiendas/${TIENDA}`,
  "tienda-pedidos": `/panel/tiendas/${TIENDA}/pedidos`,
  "tienda-presupuestos": `/panel/tiendas/${TIENDA}/presupuestos`,
  "tienda-facturas": `/panel/tiendas/${TIENDA}/facturas`,
  "tienda-facturacion": `/panel/tiendas/${TIENDA}/facturacion`,
  "tienda-cobros": `/panel/tiendas/${TIENDA}/cobros`,
  "tienda-clientes": `/panel/tiendas/${TIENDA}/clientes`,
  "tienda-productos": `/panel/tiendas/${TIENDA}/productos`,
  "tienda-ajustes": `/panel/tiendas/${TIENDA}/ajustes`,
  "textil-inicio": "/panel/textil",
  "textil-pedidos": "/panel/textil/pedidos",
  "textil-presupuestos": "/panel/textil/presupuestos",
  "textil-facturas": "/panel/textil/facturas",
  "textil-stock": "/panel/textil/stock",
  "textil-compras": "/panel/textil/compras",
  "textil-clientes": "/panel/textil/clientes",
  "textil-ajustes": "/panel/textil/ajustes",
};

const TAMANOS = {
  escritorio: { width: 1440, height: 900 },
  movil: { width: 390, height: 844 },
};

// Lunes 5 de octubre de 2026, a media mañana, hora de Madrid.
const HOY = new Date("2026-10-05T10:00:00+02:00");

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

for (const [tamano, viewport] of Object.entries(TAMANOS)) {
  if (SOLO && SOLO !== tamano) continue;
  mkdirSync(join(carpeta, tamano), { recursive: true });
  const contexto = await navegador.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const sesionJson = JSON.stringify(sesion());
  await contexto.addInitScript((s) => {
    localStorage.setItem("sb-localhost-auth-token", s);
  }, sesionJson);

  for (const [nombre, ruta] of Object.entries(RUTAS)) {
    if (FILTRO && !FILTRO.includes(nombre)) continue;
    const pagina = await contexto.newPage();
    await pagina.clock.setFixedTime(HOY);
    const errores = [];
    pagina.on("pageerror", (e) => errores.push(e.message));
    await pagina.goto(BASE + ruta, { waitUntil: "networkidle" });
    // Sin transiciones: un menú que aún está cambiando de color al hacer la
    // foto deja píxeles distintos de una pasada a otra con el mismo código.
    await pagina.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; }",
    });
    await pagina.waitForTimeout(1500);
    // La captura de página entera cambia el tamaño de la ventana, y eso hace
    // que las gráficas se redibujen con animación: la foto las pillaba a
    // medias, y a medias distintas según lo que tardase la página. Así que
    // primero se agranda la ventana a lo que mide la página, se deja que las
    // gráficas terminen, y luego se hace la foto.
    const alto = await pagina.evaluate(() => document.documentElement.scrollHeight);
    await pagina.setViewportSize({
      width: viewport.width,
      height: Math.max(alto, viewport.height),
    });
    await pagina.waitForTimeout(2000);
    await pagina.screenshot({
      path: join(carpeta, tamano, `${nombre}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
    console.log(`${tamano}/${nombre}${errores.length ? `  ERRORES: ${errores.join(" | ")}` : ""}`);
    await pagina.close();
  }
  await contexto.close();
}
await navegador.close();
