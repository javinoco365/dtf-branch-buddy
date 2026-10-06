// Un Supabase de mentira para las pruebas visuales.
//
// Imita lo justo para que el panel cargue con datos fijos: la sesión, la
// lectura de tablas con los filtros más usados y las funciones (rpc). No
// escribe nada en ningún sitio: las altas y cambios responden «hecho» y se
// olvidan. Nunca habla con la base de datos real.
//
// Uso:  node pruebas-visuales/supabase-falso.mjs [puerto]
// Cada petición se apunta en la salida, para saber qué pide cada pantalla.

import http from "node:http";
import { DATOS, RPC, USUARIO, sesion } from "./datos.mjs";

const PUERTO = Number(process.argv[2] ?? 54399);

// --- Filtros de PostgREST, los que usa la aplicación ------------------------
function convertir(v) {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

// «pedido.fecha_pedido» filtra por un campo de la tabla relacionada.
function campo(fila, columna) {
  return columna.split(".").reduce((o, k) => (o == null ? undefined : o[k]), fila);
}

function cumple(fila, columna, expresion) {
  const valor = campo(fila, columna);
  const negado = expresion.startsWith("not.");
  const exp = negado ? expresion.slice(4) : expresion;
  const punto = exp.indexOf(".");
  const op = exp.slice(0, punto);
  const arg = exp.slice(punto + 1);
  let r;
  switch (op) {
    case "eq":
      r = String(valor) === arg || valor === convertir(arg);
      break;
    case "neq":
      r = String(valor) !== arg;
      break;
    case "is":
      r = arg === "null" ? valor == null : valor === convertir(arg);
      break;
    case "in": {
      const lista = arg
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((s) => s.replace(/^"|"$/g, ""));
      r = lista.includes(String(valor));
      break;
    }
    case "gte":
      r = valor != null && String(valor) >= arg;
      break;
    case "gt":
      r = valor != null && String(valor) > arg;
      break;
    case "lte":
      r = valor != null && String(valor) <= arg;
      break;
    case "lt":
      r = valor != null && String(valor) < arg;
      break;
    default:
      // ilike, or, fts…: no se filtra. Mejor de más que una pantalla vacía.
      r = true;
  }
  return negado ? !r : r;
}

const RESERVADOS = new Set(["select", "order", "limit", "offset", "or", "and", "on_conflict"]);

function leerTabla(tabla, query) {
  let filas = [...(DATOS[tabla] ?? [])];
  for (const [clave, valor] of query) {
    if (RESERVADOS.has(clave)) continue;
    filas = filas.filter((f) => cumple(f, clave, valor));
  }
  const orden = query.get("order");
  if (orden) {
    const [col, dir] = orden.split(",")[0].split(".");
    filas.sort((a, b) => {
      const x = a[col] ?? "";
      const y = b[col] ?? "";
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === "desc" ? -c : c;
    });
  }
  const limite = Number(query.get("limit") ?? "0");
  if (limite > 0) filas = filas.slice(0, limite);
  return filas;
}

// --- El servidor ------------------------------------------------------------
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
  "access-control-expose-headers": "content-range, x-total-count",
};

function responder(res, estado, cuerpo, extra = {}) {
  res.writeHead(estado, { "content-type": "application/json", ...CORS, ...extra });
  res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo));
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const ruta = url.pathname;
  console.log(`${req.method} ${ruta}${url.search}`);

  if (req.method === "OPTIONS") return responder(res, 204);

  // Sesión
  if (ruta === "/auth/v1/user") return responder(res, 200, USUARIO);
  if (ruta === "/auth/v1/token") return responder(res, 200, sesion());
  if (ruta.startsWith("/auth/v1/")) return responder(res, 200, {});

  // Funciones
  const rpc = ruta.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
  if (rpc) {
    const r = RPC[rpc[1]];
    return responder(res, 200, typeof r === "function" ? r() : (r ?? null));
  }

  // Tablas
  const t = ruta.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
  if (t) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Altas, cambios y bajas: «hecho», sin guardar nada.
      req.resume();
      return responder(res, 201, []);
    }
    const filas = leerTabla(t[1], url.searchParams);
    const rango = { "content-range": `0-${Math.max(filas.length - 1, 0)}/${filas.length}` };
    if (req.method === "HEAD") return responder(res, 200, undefined, rango);
    const unaSola = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (unaSola) {
      if (filas.length === 0) {
        return responder(res, 406, {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: "The result contains 0 rows",
          hint: null,
        });
      }
      return responder(res, 200, filas[0], rango);
    }
    return responder(res, 200, filas, rango);
  }

  // Almacenamiento y lo demás: no hay nada.
  return responder(res, 404, { message: "No existe en el Supabase de prueba" });
});

servidor.listen(PUERTO, () => console.log(`Supabase de prueba en http://localhost:${PUERTO}`));
