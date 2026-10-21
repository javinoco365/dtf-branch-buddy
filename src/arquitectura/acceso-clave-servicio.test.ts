import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Ninguna server function nueva usa la clave de servicio sin control de acceso.
//
// `requireSupabaseAuth` solo dice que el token es válido: cualquiera con una
// cuenta lo tiene. Si después el handler escribe o lee con `supabaseAdmin` o
// `adminComoUsuario()`, la RLS ya no protege nada. Así nacieron, abiertas,
// borrarMovimientoCaja, borrarGastoFijo, borrarInversion, urlFacturaTextil,
// diagnosticoNumeroWoo o enviarAvisoPedidoEnviado (hallazgo S1 de la
// auditoría de seguridad de octubre de 2026).
//
// La regla: un handler de src/lib/*.functions.ts que importa
// `@/integrations/supabase/client.server` tiene que llamar a uno de los
// ayudantes de src/lib/acceso.ts (exigirAdmin, exigirMiembroEmpresa,
// exigirMiembroTienda), llevar el middleware exigeAdmin, o estar en la lista de abajo con el motivo por el que
// está comprobado de otra manera. Mejor que añadir una excepción: escribir con
// `context.supabase` y dejar decidir a la RLS.
//
// Además, ningún *.functions.ts importa client.server en el nivel superior:
// ese fichero también va al bundle del navegador (CLAUDE.md, Seguridad).
//
// Límite conocido: solo mira el cuerpo del handler. Si el handler delega en
// una función auxiliar que es la que usa la clave de servicio, no lo ve.

const RAIZ_LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib");

const AYUDANTE = /\bexigir(Admin|MiembroEmpresa|MiembroTienda)\(/;

// El middleware de niveles exigeAdmin (src/lib/permisos-middleware.ts) también
// cuenta: comprueba con la sesión del usuario que es admin activo antes de que
// el handler cree el cliente de servicio. exigeEscribir y exigeBorrar no: miran
// el nivel, no la tienda ni la empresa.
const MIDDLEWARE_ADMIN = /\.middleware\(\[[^\]]*\bexigeAdmin\b[^\]]*\]\)/;

/**
 * Handlers que usan la clave de servicio y comprueban el acceso de otra forma.
 * Cada entrada dice cómo. Revisadas una a una el 31-10-2026.
 */
export const COMPROBADOS_DE_OTRA_FORMA: Record<string, string> = {
  "admin.functions.ts:bootstrapPrimerAdmin":
    "Pública a propósito: solo actúa si no hay ningún administrador (ver S10).",
  "admin.functions.ts:adminExiste": "Pública: solo devuelve si existe algún administrador.",
  "admin.functions.ts:credencialesWooMascaradas": "esAdminActivo(): solo administradores activos.",
  "archivo.functions.ts:urlsArchivo":
    "Lee las facturas y compras con context.supabase (RLS) y el textil exige administrador.",
  "cobros.functions.ts:registrarCobro": "comprobarAcceso(): el pedido se lee con la sesión.",
  "cobros.functions.ts:borrarCobro": "El cobro se lee con la sesión antes de borrarlo.",
  "compras.functions.ts:guardarYRegistrarCompra":
    "textil_compra_guardar_y_registrar() exige es_miembro_empresa(_usuario_id).",
  "compras.functions.ts:releerFacturaRecibida": "La compra se lee con la sesión (RLS).",
  "compras.functions.ts:verFicheroCompra": "La compra se lee con la sesión (RLS).",
  "compras.functions.ts:adjuntarFicheroCompra": "La compra se lee con la sesión (RLS).",
  "correos.functions.ts:enviarAvisoPedidoEnviado": "El pedido se lee con la sesión (RLS).",
  "escaner-textil.functions.ts:fusionarVariantes":
    "textil_stock_fusionar() exige es_miembro_empresa(_usuario_id).",
  "facturas.functions.ts:generarYSubirFacturaPDF": "comprobarAccesoTienda().",
  "facturas.functions.ts:rellenarPdfsTienda":
    "Las facturas se leen con la sesión; leerDatosPdfFactura() comprueba la tienda.",
  "facturas.functions.ts:enviarDocumentoPorCorreo": "leerDatosPdfFactura() comprueba la tienda.",
  "facturas.functions.ts:emitirFactura":
    "fechaDeEmision() comprueba la tienda y emitir_factura() exige is_tienda_member.",
  "facturas.functions.ts:prepararFacturaPedido": "leerPedidoParaDocumento() comprueba la tienda.",
  "facturas.functions.ts:emitirTicket":
    "fechaDeEmision() comprueba la tienda y emitir_factura() exige is_tienda_member.",
  "facturas.functions.ts:pedidosSinDocumento": "comprobarAccesoTienda().",
  "facturas.functions.ts:pedidosParaFacturar": "comprobarAccesoTienda() de cada tienda.",
  "facturas.functions.ts:emitirFacturasPedidos":
    "emitirEnBloque(): leerPedidoParaDocumento() comprueba la tienda de cada pedido.",
  "facturas.functions.ts:anularFactura":
    "anular_factura() emite con emitir_factura(), que exige is_tienda_member.",
  "facturas.functions.ts:borrarUltimaFactura": "factura_borrar_ultima() con la sesión del usuario.",
  "facturas.functions.ts:cambiarEstadoCobro":
    "factura_cambiar_estado_cobro() exige is_tienda_member(_usuario_id).",
  "facturas.functions.ts:fijarInicioSerie":
    "serie_fijar_inicio() exige es_miembro_empresa(_usuario_id).",
  "facturas.functions.ts:canjearTicket": "comprobarAccesoTienda().",
  "pedidos.functions.ts:fijarRealizadoPedido": "esAdminActivo(): solo administradores activos.",
  "pedidos.functions.ts:fijarCosteEnvioPedido": "esAdminActivo(): solo administradores activos.",
  "pedidos.functions.ts:createPedidoManual": "ensureAccess(): de la tienda o administrador.",
  "pedidos.functions.ts:updatePedidoEstado": "ensureAccess(): de la tienda o administrador.",
  "pedidos.functions.ts:updatePedido": "ensureAccess(): de la tienda o administrador.",
  "pedidos.functions.ts:setPedidoTracking": "ensureAccess(): de la tienda o administrador.",
  "pedidos.functions.ts:deletePedido": "ensureAccess(): de la tienda o administrador.",
  "presupuesto-imagenes.functions.ts:subirImagenPresupuesto":
    "El presupuesto se lee con la sesión (RLS) antes de subir.",
  "presupuesto-imagenes.functions.ts:quitarImagenPresupuesto":
    "La imagen se lee con la sesión (RLS) antes de quitarla.",
  "presupuestos.functions.ts:borrarPresupuesto":
    "Se borra con la sesión; las imágenes solo si la RLS dejó borrar (exigirFilas).",
  "textil.functions.ts:deletePresupuesto":
    "Se borra con la sesión; las imágenes solo si la RLS dejó borrar (exigirFilas).",
  "textil.functions.ts:deleteTextilFactura": "factura_borrar_ultima() con la sesión del usuario.",
  "textil.functions.ts:generarPdfFacturaTextil": "leerDatosPdfTextil(): solo administradores.",
  "textil.functions.ts:rellenarPdfsTextil": "leerDatosPdfTextil(): solo administradores.",
  "textil.functions.ts:urlFacturaTextil": "La factura se lee con la sesión (RLS) antes de firmar.",
  "textil.functions.ts:emitirDocumentoTextil":
    "El pedido se lee con la sesión y emitir_factura_textil() exige es_miembro_empresa.",
  "textil.functions.ts:canjearTicketTextil":
    "El ticket se lee con la sesión y emitir_factura_textil() exige es_miembro_empresa.",
  "textil.functions.ts:anularTicketTextil":
    "El ticket se lee con la sesión y emitir_factura_textil() exige es_miembro_empresa.",
  "woocommerce.functions.ts:sincronizarWoo":
    "esMiembroTienda() (is_tienda_member): de la tienda o administrador.",
  "woocommerce.functions.ts:sincronizarClientesWoo":
    "esMiembroTienda() (is_tienda_member): de la tienda o administrador.",
  "woocommerce.functions.ts:diagnosticoLineasWoo":
    "esMiembroTienda() (is_tienda_member): de la tienda o administrador.",
  "woocommerce.functions.ts:recuperarEnviosWoo":
    "esMiembroTienda() (is_tienda_member): de la tienda o administrador.",
  "woocommerce.functions.ts:recuperarRealizadoWoo":
    "esAdminActivo(): solo administradores activos.",
};

export type Handler = { clave: string; cuerpo: string };

/** Cada `export const X = createServerFn(...)` del fichero, hasta el cierre de su handler. */
export function handlersDe(fichero: string, fuente: string): Handler[] {
  const salida: Handler[] = [];
  const patron = /\nexport const (\w+) = createServerFn/g;
  let m: RegExpExecArray | null;
  while ((m = patron.exec(fuente))) {
    const inicio = m.index;
    const finales = [fuente.indexOf("\nexport ", inicio + 1), fuente.indexOf("\n  });", inicio)]
      .filter((i) => i !== -1)
      .sort((a, b) => a - b);
    const fin = finales[0] ?? fuente.length;
    salida.push({ clave: `${fichero}:${m[1]}`, cuerpo: fuente.slice(inicio, fin) });
  }
  return salida;
}

export function usaClaveDeServicio(cuerpo: string): boolean {
  return cuerpo.includes("client.server");
}

export function compruebaAcceso(cuerpo: string): boolean {
  return AYUDANTE.test(cuerpo) || MIDDLEWARE_ADMIN.test(cuerpo);
}

function ficherosFunctions(): { nombre: string; fuente: string }[] {
  return readdirSync(RAIZ_LIB)
    .filter((n) => n.endsWith(".functions.ts"))
    .map((nombre) => ({ nombre, fuente: readFileSync(path.join(RAIZ_LIB, nombre), "utf8") }));
}

describe("handlers con la clave de servicio", () => {
  const ficheros = ficherosFunctions();
  const handlers = ficheros.flatMap((f) => handlersDe(f.nombre, f.fuente));

  it("encuentra los handlers (la prueba no se ha quedado ciega)", () => {
    expect(handlers.length).toBeGreaterThan(50);
    expect(handlers.filter((h) => usaClaveDeServicio(h.cuerpo)).length).toBeGreaterThan(20);
  });

  it("todos los que usan la clave de servicio comprueban el acceso", () => {
    const abiertos = handlers
      .filter((h) => usaClaveDeServicio(h.cuerpo))
      .filter((h) => !compruebaAcceso(h.cuerpo))
      .filter((h) => !(h.clave in COMPROBADOS_DE_OTRA_FORMA))
      .map((h) => h.clave);
    expect(abiertos).toEqual([]);
  });

  it("la lista de excepciones no tiene entradas viejas", () => {
    const vivas = new Set(
      handlers
        .filter((h) => usaClaveDeServicio(h.cuerpo) && !compruebaAcceso(h.cuerpo))
        .map((h) => h.clave),
    );
    const sobran = Object.keys(COMPROBADOS_DE_OTRA_FORMA).filter((k) => !vivas.has(k));
    expect(sobran).toEqual([]);
  });

  it("ningún *.functions.ts importa client.server en el nivel superior", () => {
    const culpables = ficheros
      .filter((f) =>
        /^import[^;]*from\s+["']@\/integrations\/supabase\/client\.server["']/m.test(f.fuente),
      )
      .map((f) => f.nombre);
    expect(culpables).toEqual([]);
  });
});

describe("las piezas de la prueba", () => {
  it("detecta un handler abierto", () => {
    const fuente = `
export const borrarAlgo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    await adminComoUsuario(context.userId).from("x").delete().eq("id", data.id);
  });
`;
    const [h] = handlersDe("x.functions.ts", fuente);
    expect(h.clave).toBe("x.functions.ts:borrarAlgo");
    expect(usaClaveDeServicio(h.cuerpo)).toBe(true);
    expect(compruebaAcceso(h.cuerpo)).toBe(false);
  });

  it("acepta uno que comprueba antes", () => {
    const fuente = `
export const borrarAlgo = createServerFn({ method: "POST" })
  .handler(async ({ data, context }) => {
    await exigirMiembroEmpresa(context.supabase, context.userId, data.empresa_id);
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
  });
`;
    const [h] = handlersDe("x.functions.ts", fuente);
    expect(compruebaAcceso(h.cuerpo)).toBe(true);
  });

  it("no mezcla un handler con el siguiente", () => {
    const fuente = `
export const a = createServerFn({ method: "GET" })
  .handler(async () => {
    return 1;
  });

export const b = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  });
`;
    const hs = handlersDe("x.functions.ts", fuente);
    expect(hs.map((h) => [h.clave, usaClaveDeServicio(h.cuerpo)])).toEqual([
      ["x.functions.ts:a", false],
      ["x.functions.ts:b", true],
    ]);
  });
});
