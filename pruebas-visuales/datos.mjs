// Datos fijos para las pruebas visuales. Inventados, deterministas y sin
// ninguna relación con clientes reales: solo sirven para que cada pantalla se
// pinte siempre igual y se pueda comparar antes y después de un cambio.

export const USUARIO = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "prueba@ejemplo.com",
  app_metadata: { provider: "email" },
  user_metadata: { nombre: "Usuario de prueba" },
  created_at: "2026-01-01T00:00:00Z",
};

// Un JWT con la firma de adorno: el servidor de la aplicación lo valida
// preguntando a /auth/v1/user, que es el Supabase de prueba.
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma-de-prueba`;
}

export function sesion() {
  return {
    access_token: jwt({
      sub: USUARIO.id,
      email: USUARIO.email,
      role: "authenticated",
      aud: "authenticated",
      exp: 4102444800,
    }),
    refresh_token: "refresco-de-prueba",
    token_type: "bearer",
    expires_in: 3600 * 24 * 365 * 50,
    expires_at: 4102444800,
    user: USUARIO,
  };
}

export const EMPRESA = "00000000-0000-4000-8000-0000000000e1";
export const TIENDA = "00000000-0000-4000-8000-0000000000a1";
export const TIENDA_2 = "00000000-0000-4000-8000-0000000000a2";

export const DATOS = {
  user_roles: [{ user_id: USUARIO.id, role: "admin" }],
  empresas: [
    {
      id: EMPRESA,
      activa: true,
      razon_social: "EMPRESA DE PRUEBA S.L.",
      cif: "B00000000",
      direccion: "Calle Ejemplo 1",
      codigo_postal: "21000",
      ciudad: "Huelva",
      provincia: "Huelva",
      pais: "España",
      email_fiscal: "fiscal@ejemplo.com",
      telefono: "600000000",
      serie_factura: "",
      serie_rectificativa: "R",
      serie_simplificada: "T",
      limite_simplificada: 400,
      limite_simplificada_particular: 3000,
      coste_consumibles_metro: 1.2,
      coste_packaging_metro: 0.3,
      coste_electricidad_metro: 0.15,
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
  tiendas: [
    {
      id: TIENDA,
      empresa_id: EMPRESA,
      nombre: "Tienda Uno",
      slug: "tienda-uno",
      prefijo: "TUNO",
      activa: true,
      url: "https://tienda-uno.ejemplo.com",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: TIENDA_2,
      empresa_id: EMPRESA,
      nombre: "Tienda Dos",
      slug: "tienda-dos",
      prefijo: "TDOS",
      activa: true,
      url: "https://tienda-dos.ejemplo.com",
      created_at: "2026-02-01T00:00:00Z",
    },
  ],
  tienda_usuarios: [
    { tienda_id: TIENDA, user_id: USUARIO.id },
    { tienda_id: TIENDA_2, user_id: USUARIO.id },
  ],
};

export const RPC = {
  // Primer pedido (20261103100000): uno de cada tres es el primero de su
  // cliente, otro repite y el tercero es dudoso (solo coincide el nombre).
  primer_pedido_resumen: () => [
    ...PEDIDOS.map((p, i) => ({
      origen: "tienda",
      id: p.id,
      tiene_datos: true,
      cancelado: p.estado === "cancelado",
      fuertes: i % 3 === 1 ? 1 : 0,
      solo_nombre: i % 3 === 2 ? 2 : 0,
      decision: null,
    })),
    ...TEXTIL_PEDIDOS.map((p, i) => ({
      origen: "textil",
      id: p.id,
      tiene_datos: true,
      cancelado: false,
      fuertes: 0,
      solo_nombre: i === 1 ? 1 : 0,
      decision: null,
    })),
  ],
  primer_pedido_parecidos: () => [
    {
      origen: "tienda",
      id: PEDIDOS[0].id,
      procedencia: "Tienda Uno",
      numero: PEDIDOS[0].numero,
      fecha: PEDIDOS[0].fecha_pedido,
      nombre: PEDIDOS[0].cliente_nombre,
      email: "otro@ejemplo.com",
      telefono: null,
      motivos: ["nombre"],
      fuerte: false,
    },
    {
      origen: "textil",
      id: TEXTIL_PEDIDOS[0].id,
      procedencia: "Textil personalizado",
      numero: TEXTIL_PEDIDOS[0].numero,
      fecha: TEXTIL_PEDIDOS[0].fecha,
      nombre: PEDIDOS[0].cliente_nombre,
      email: null,
      telefono: "600000009",
      motivos: ["nombre"],
      fuerte: false,
    },
  ],
  // Niveles (20261031200100): el usuario de prueba es admin activo, como el
  // de user_roles. Sin esto la app lo vería sin nivel y en solo lectura.
  mi_nivel: "admin",
  // Control de acceso de src/lib/acceso.ts (seguridad, S1): el usuario de
  // prueba es admin, así que es de todas las tiendas y de la empresa.
  has_role: true,
  es_miembro_empresa: true,
  is_tienda_member: true,
};

// ---------------------------------------------------------------------------
// Pedidos, cobros y lo que cuelga de ellos
// ---------------------------------------------------------------------------
const id = (prefijo, n) =>
  `00000000-0000-4000-8000-${prefijo}${String(n).padStart(12 - prefijo.length, "0")}`;

const NOMBRES = [
  "Talleres Pérez S.L.",
  "Ana López Martín",
  "Club Deportivo Cartaya",
  "Serigrafía del Sur",
  "Peña La Charanga",
  "Moda Rápida Huelva",
  "Juan Ruiz",
  "Estampados Costa de la Luz S.L.",
];

const ESTADOS = [
  "pendiente",
  "en_produccion",
  "imprimiendo",
  "listo",
  "enviado",
  "entregado",
  "cancelado",
  "entregado",
];

export const CLIENTES = NOMBRES.map((nombre, i) => ({
  id: id("c", i + 1),
  empresa_id: EMPRESA,
  tienda_id: i % 2 === 0 ? TIENDA : TIENDA_2,
  nombre,
  apodo: null,
  email: `cliente${i + 1}@ejemplo.com`,
  telefono: `6000000${String(i).padStart(2, "0")}`,
  nif: i % 3 === 0 ? `B0000000${i}` : null,
  empresa: null,
  direccion: `Calle de Prueba ${i + 1}`,
  codigo_postal: "21000",
  ciudad: "Huelva",
  provincia: "Huelva",
  pais: "España",
  origen: i % 2 === 0 ? "woocommerce" : "manual",
  tipo_fiscal: i % 3 === 0 ? "profesional" : null,
  woo_customer_id: null,
  notas: null,
  created_at: `2026-0${(i % 8) + 1}-10T10:00:00Z`,
  updated_at: "2026-09-01T10:00:00Z",
}));

function fechaDia(dia, mes = 10) {
  return `2026-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T09:30:00Z`;
}

export const PEDIDOS = Array.from({ length: 14 }, (_, i) => {
  const enOctubre = i < 9;
  const dia = enOctubre ? 5 - Math.floor(i / 2) : 28 - i;
  const articulos = [30, 45.5, 120, 18.75, 260, 64, 12.4, 88, 310, 22, 75, 140, 33, 51][i];
  const envio = i % 3 === 0 ? 5.95 : 0;
  // Como los pedidos reales (WooCommerce y manuales): la base, `subtotal`,
  // lleva el envío dentro, y el total es base + IVA.
  const subtotal = Math.round((articulos + envio) * 100) / 100;
  const iva = Math.round(subtotal * 0.21 * 100) / 100;
  const total = Math.round((subtotal + iva) * 100) / 100;
  const cliente = CLIENTES[i % CLIENTES.length];
  const estado = ESTADOS[i % ESTADOS.length];
  const tienda = i % 2 === 0 ? TIENDA : TIENDA_2;
  return {
    id: id("b", i + 1),
    empresa_id: EMPRESA,
    tienda_id: tienda,
    numero: `${tienda === TIENDA ? "TUNO" : "TDOS"}-${60 - i}-2026`,
    woo_order_id: i % 3 === 2 ? null : 9000 + i,
    origen: i % 3 === 2 ? "manual" : "woocommerce",
    fecha_pedido: enOctubre ? fechaDia(Math.max(dia, 1)) : fechaDia(dia, 9),
    cliente_id: cliente.id,
    cliente_nombre: cliente.nombre,
    cliente_email: cliente.email,
    cliente_telefono: cliente.telefono,
    estado,
    estado_pago: i % 4 === 1 ? "parcial" : i % 4 === 3 ? "pendiente" : "pagado",
    estado_produccion:
      estado === "pendiente"
        ? "sin_empezar"
        : estado === "imprimiendo"
          ? "imprimiendo"
          : "terminado",
    estado_envio:
      estado === "enviado" ? "en_transito" : estado === "entregado" ? "entregado" : "sin_enviar",
    cancelado_en: estado === "cancelado" ? fechaDia(4) : null,
    subtotal,
    iva,
    envio,
    total,
    metros_total: Math.round((articulos / 12) * 100) / 100,
    metodo_pago: i % 2 === 0 ? "tarjeta" : "transferencia",
    notas: i === 2 ? "Entregar antes del viernes" : null,
    fecha_entrega: null,
    direccion_facturacion: {
      nombre: cliente.nombre,
      direccion: cliente.direccion,
      ciudad: "Huelva",
      pais: "ES",
    },
    direccion_envio: {
      nombre: cliente.nombre,
      direccion: cliente.direccion,
      ciudad: "Huelva",
      pais: "ES",
    },
    created_at: fechaDia(1),
    updated_at: fechaDia(1),
  };
});

export const PEDIDO_ITEMS = PEDIDOS.flatMap((p, i) => [
  {
    id: id("d", i * 2 + 1),
    pedido_id: p.id,
    producto_id: null,
    descripcion: "Metro DTF 57 cm",
    cantidad: p.metros_total,
    unidad: "m",
    precio_unitario: 12,
    iva_rate: 21,
    // La línea, sin el envío: el envío no es una línea del pedido.
    subtotal: Math.round((p.subtotal - p.envio) * 100) / 100,
    iva: Math.round((p.subtotal - p.envio) * 0.21 * 100) / 100,
    total: Math.round((p.subtotal - p.envio) * 1.21 * 100) / 100,
    // El primero, estimado (importe ÷ precio por metro): se ve «≈ … estimado».
    metros_origen: i === 0 ? "precio_ajustes" : "montador",
    precio_metro_usado: i === 0 ? 7 : null,
    created_at: p.created_at,
    pedidos: { fecha_pedido: p.fecha_pedido, tienda_id: p.tienda_id, estado: p.estado },
    pedido: { tienda_id: p.tienda_id },
  },
]);

// Lo cobrado: entero en los pagados, la mitad en los parciales.
export const COBROS = PEDIDOS.filter((p) => p.estado_pago !== "pendiente").map((p, i) => ({
  id: id("f", i + 1),
  empresa_id: EMPRESA,
  pedido_id: p.id,
  textil_pedido_id: null,
  fecha: p.fecha_pedido.slice(0, 10),
  importe: p.estado_pago === "parcial" ? Math.round(p.total * 50) / 100 : p.total,
  propina: i === 1 ? 2 : 0,
  metodo: p.origen === "woocommerce" ? "web" : i % 2 ? "efectivo" : "tarjeta",
  previo: false,
  automatico: p.origen === "woocommerce",
  notas: null,
  created_at: p.fecha_pedido,
  pedido: {
    id: p.id,
    numero: p.numero,
    fecha_pedido: p.fecha_pedido,
    tienda_id: p.tienda_id,
    cliente_nombre: p.cliente_nombre,
    total: p.total,
    iva: p.iva,
    envio: p.envio,
    metros_total: p.metros_total,
  },
}));

export const PENDIENTES = PEDIDOS.filter((p) => p.estado_pago !== "pagado" && !p.cancelado_en).map(
  (p) => {
    const cobrado = p.estado_pago === "parcial" ? Math.round(p.total * 50) / 100 : 0;
    return {
      tipo: "tienda",
      id: p.id,
      empresa_id: EMPRESA,
      tienda_id: p.tienda_id,
      numero: p.numero,
      fecha: p.fecha_pedido.slice(0, 10),
      cliente_id: p.cliente_id,
      cliente_nombre: p.cliente_nombre,
      origen: p.origen,
      estado: p.estado,
      total: p.total,
      cobrado,
      pendiente: Math.round((p.total - cobrado) * 100) / 100,
      ultimo_cobro: cobrado ? p.fecha_pedido.slice(0, 10) : null,
    };
  },
);

export const FACTURAS = PEDIDOS.slice(0, 6).map((p, i) => ({
  id: id("e", i + 1),
  empresa_id: EMPRESA,
  tienda_id: p.tienda_id,
  pedido_id: p.id,
  cliente_id: p.cliente_id,
  tipo: i % 2 === 0 ? "simplificada" : "ordinaria",
  serie: i % 2 === 0 ? "T" : "",
  numero: i + 1,
  ejercicio: 2026,
  fecha: p.fecha_pedido.slice(0, 10),
  fecha_vencimiento: null,
  base_imponible: p.subtotal,
  iva_total: p.iva,
  total: p.total,
  desglose_iva: [{ tipo: 21, base: p.subtotal, cuota: p.iva }],
  estado: i % 2 === 0 ? "pagada" : "emitida",
  cliente_nombre: i % 2 === 0 ? null : p.cliente_nombre,
  cliente_nif: i % 2 === 0 ? null : "B00000001",
  cliente_direccion: null,
  emisor_nombre: "EMPRESA DE PRUEBA S.L.",
  emisor_cif: "B00000000",
  emisor_direccion: "Calle Ejemplo 1",
  receptor_snapshot: { nombre: p.cliente_nombre, email: p.cliente_email },
  rectifica_a_id: null,
  sustituye_a_id: null,
  pdf_url: null,
  notas: null,
  created_at: p.fecha_pedido,
  updated_at: p.fecha_pedido,
  banco_conciliaciones: [],
}));

export const PRODUCTOS = [
  ["Metro DTF 57 cm", "m", 12],
  ["Metro DTF UV", "m", 18],
  ["Montaje de transfer", "ud", 2.5],
  ["Diseño y maquetación", "ud", 25],
].map(([nombre, unidad, precio], i) => ({
  id: id("p", i + 1),
  empresa_id: EMPRESA,
  tienda_id: i < 2 ? null : TIENDA,
  nombre,
  descripcion: null,
  sku: `SKU-${i + 1}`,
  unidad,
  precio_unitario: precio,
  iva_rate: 21,
  activo: true,
  woo_product_id: i === 2 ? 501 : null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}));

export const PRESUPUESTOS = [0, 1, 2].map((i) => ({
  id: id("a", i + 1),
  empresa_id: EMPRESA,
  tienda_id: TIENDA,
  numero: `PRES-TUNO-2026-000${i + 1}`,
  fecha: fechaDia(2 + i).slice(0, 10),
  validez_dias: 30,
  cliente_id: CLIENTES[i].id,
  cliente_nombre: CLIENTES[i].nombre,
  cliente_email: CLIENTES[i].email,
  cliente_nif: null,
  cliente_direccion: null,
  estado: ["borrador", "enviado", "aceptado"][i],
  envio: 0,
  subtotal: 100 + i * 50,
  iva: (100 + i * 50) * 0.21,
  total: (100 + i * 50) * 1.21,
  notas: null,
  pedido_id: i === 2 ? PEDIDOS[0].id : null,
  pedido: i === 2 ? { numero: PEDIDOS[0].numero } : null,
  created_at: fechaDia(2 + i),
  items: [
    {
      id: id("a1", i + 1),
      orden: 0,
      descripcion: "Metro DTF 57 cm",
      cantidad: 10 + i,
      unidad: "m",
      precio_unitario: 10,
      iva_rate: 21,
      subtotal: 100 + i * 50,
      iva: (100 + i * 50) * 0.21,
      total: (100 + i * 50) * 1.21,
    },
  ],
}));

// ---------------------------------------------------------------------------
// Caja, inversión y banco
// ---------------------------------------------------------------------------
const SOCIOS = ["Socio A", "Socio B"].map((nombre, i) => ({
  id: id("5", i + 1),
  empresa_id: EMPRESA,
  nombre,
  activo: true,
  orden: i,
  created_at: "2026-01-01T00:00:00Z",
}));

const CONCEPTOS = [
  ["Venta en tienda", "ingreso"],
  ["Material de impresión", "gasto"],
  ["Mensajería", "gasto"],
].map(([nombre, categoria], i) => ({
  id: id("6", i + 1),
  empresa_id: EMPRESA,
  nombre,
  categoria,
  activo: true,
  orden: i,
  created_at: "2026-01-01T00:00:00Z",
}));

const CAJA = [0, 1, 2, 3, 4].map((i) => {
  const c = CONCEPTOS[i % 3];
  return {
    id: id("7", i + 1),
    empresa_id: EMPRESA,
    fecha: fechaDia(5 - i).slice(0, 10),
    categoria: c.categoria,
    concepto_id: c.id,
    concepto_nombre: c.nombre,
    cliente_id: c.categoria === "ingreso" ? CLIENTES[i].id : null,
    cliente_nombre: c.categoria === "ingreso" ? CLIENTES[i].nombre : null,
    socio_id: c.categoria === "gasto" ? SOCIOS[i % 2].id : null,
    socio_nombre: c.categoria === "gasto" ? SOCIOS[i % 2].nombre : null,
    importe: [45, 120.5, 12, 30, 64.2][i],
    observaciones: i === 1 ? "Rollo de film" : null,
    created_at: fechaDia(5 - i),
  };
});

const INVERSION = [0, 1, 2].map((i) => ({
  id: id("8", i + 1),
  empresa_id: EMPRESA,
  fecha: fechaDia(1 + i, 9).slice(0, 10),
  socio_id: SOCIOS[i % 2].id,
  socio_nombre: SOCIOS[i % 2].nombre,
  tipo: i === 2 ? "retirada" : "aportacion",
  importe: [3000, 2000, 500][i],
  observaciones: null,
  created_at: fechaDia(1 + i, 9),
}));

// Cuentas y extractos (20261016100000).
const CUENTAS_BANCO = [
  {
    id: id("cb", 1),
    empresa_id: EMPRESA,
    banco: "BBVA",
    alias: "Principal",
    iban: ["ES91", "2100", "0418", "4502", "0005", "1332"].join(""),
    activa: true,
    created_at: fechaDia(1, 1),
  },
  {
    id: id("cb", 2),
    empresa_id: EMPRESA,
    banco: "Revolut",
    alias: "Tarjetas",
    iban: null,
    activa: true,
    created_at: fechaDia(2, 1),
  },
];
const EXTRACTOS_BANCO = [
  {
    id: id("eb", 1),
    empresa_id: EMPRESA,
    cuenta_id: id("cb", 1),
    fichero: "bbva-septiembre.xlsx",
    formato: { tipo: "excel", ambiguo: [] },
    desde: "2026-09-01",
    hasta: "2026-09-30",
    saldo_inicial: 1800,
    saldo_final: 1913.96,
    suma_movimientos: 113.96,
    movimientos: 3,
    nuevos: 3,
    cuadra: true,
    created_at: fechaDia(1, 10),
  },
  {
    id: id("eb", 2),
    empresa_id: EMPRESA,
    cuenta_id: id("cb", 2),
    fichero: "revolut-septiembre.csv",
    formato: { tipo: "csv", codificacion: "UTF-8", separador: ",", ambiguo: [] },
    desde: "2026-09-02",
    hasta: "2026-09-29",
    saldo_inicial: null,
    saldo_final: null,
    suma_movimientos: -42.1,
    movimientos: 5,
    nuevos: 4,
    cuadra: false,
    created_at: fechaDia(2, 10),
  },
];

const BANCO = [0, 1, 2].map((i) => ({
  id: id("9", i + 1),
  empresa_id: EMPRESA,
  fecha: fechaDia(3 + i, 9).slice(0, 10),
  concepto: ["TRANSFERENCIA TALLERES PEREZ", "RECIBO LUZ", "BIZUM ANA LOPEZ"][i],
  importe: [154.88, -86.3, 45.38][i],
  huella: `h${i}`,
  origen: "extracto.csv",
  created_at: fechaDia(3 + i, 9),
  cuenta_id: null,
  traspaso_con: null,
  conciliacion: [],
  banco_conciliaciones: [],
}));
// Para el motor de conciliación (20261017100000): un verde por nombre, un
// ámbar (pago con tarjeta que no dice a quién), un traspaso entre cuentas y un
// enlace ya guardado en «revisar».
const movBanco = (n, cuenta, fecha, concepto, importe, traspaso_con = null) => ({
  id: id("9", 10 + n),
  empresa_id: EMPRESA,
  fecha,
  concepto,
  importe,
  huella: `hm${n}`,
  origen: "extracto.csv",
  created_at: `${fecha}T09:00:00Z`,
  cuenta_id: id("cb", cuenta),
  traspaso_con,
  conciliacion: [],
  banco_conciliaciones: [],
});
BANCO.push(
  movBanco(1, 1, "2026-10-03", "RECIBO INMOBILIARIA NAVE ALQUILER", -306),
  movBanco(2, 2, "2026-10-06", "COMPRA TARJETA 4589 DTF", -108.9),
  movBanco(3, 1, "2026-10-08", "ADEUDO SEUR ENVIOS", -30.25),
  movBanco(4, 1, "2026-10-10", "TRASPASO A TARJETAS", -500),
  movBanco(5, 2, "2026-10-11", "TRASPASO DESDE BBVA", 500),
  movBanco(6, 1, "2026-09-20", "PAGO PROVEEDOR", -363),
  // Cobro en dos partes de la factura 2026/0004 de textil (108,90): la primera
  // ya enlazada, la segunda pendiente.
  movBanco(7, 1, "2026-10-12", "TRANSF CLIENTE TEXTIL A CUENTA", 50),
  movBanco(8, 1, "2026-10-20", "TRANSF CLIENTE TEXTIL RESTO", 58.9),
  movBanco(9, 1, "2026-10-21", "ABONO TPV REMESA 20/10", 212.4),
);
const CONCILIACIONES = [
  {
    id: id("bc", 1),
    movimiento_id: id("9", 16),
    factura_id: null,
    compra_id: id("k", 1),
    textil_factura_id: null,
    estado: "revisar",
    grupo: id("bg", 1),
    motivo: "importe_fecha",
    diferencia: 0,
    importe: -363,
    marco_pagada: false,
  },
  {
    id: id("bc", 2),
    movimiento_id: id("9", 17),
    factura_id: null,
    compra_id: null,
    textil_factura_id: id("r", 2),
    estado: "conciliada",
    grupo: id("bg", 2),
    motivo: "manual",
    diferencia: -58.9,
    importe: 108.9,
    marco_pagada: false,
  },
];

// ---------------------------------------------------------------------------
// Textil
// ---------------------------------------------------------------------------
const MARCAS = [
  {
    id: id("m", 1),
    nombre: "Marca Textil",
    color: "#3b82f6",
    activa: true,
    logo_url: null,
    email: null,
    telefono: null,
    direccion: null,
    notas: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];
const marca = { id: MARCAS[0].id, nombre: MARCAS[0].nombre, color: MARCAS[0].color };

const STOCK = [
  ["Camiseta técnica", "M", "Blanco", 40, 10],
  ["Camiseta técnica", "L", "Negro", 4, 10],
  ["Sudadera capucha", "XL", "Gris", 12, 5],
].map(([nombre, talla, color, cantidad, minima], i) => ({
  id: id("s", i + 1),
  empresa_id: EMPRESA,
  nombre,
  sku: `TX-${i + 1}`,
  categoria: "Prendas",
  talla,
  color,
  cantidad,
  cantidad_minima: minima,
  coste_unitario: 3.5 + i,
  precio_venta: 9 + i * 2,
  notas: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}));

// Como llegan hoy las compras de Roly (captura de Stock del 21-10-2026): la
// referencia lleva la talla y el color, así que cada una es un producto con la
// misma marca y el mismo nombre. Stock las junta por prenda y color.
const STOCK_ROLY = [
  ["SS643201011", "Antartida", "BLANCO PERLA", "S", 5, 5, 12.55],
  ["SS643202011", "Antartida", "BLANCO PERLA", "M", 1, 1, 12.55],
  ["SS643203011", "Antartida", "BLANCO PERLA", "L", 1, 1, 12.55],
  ["SS64320105", "Antartida", "ROYAL", "S", 5, 5, 12.55],
  ["SS64320205", "Antartida", "ROYAL", "M", 1, 1, 12.55],
  ["SS64320305", "Antartida", "ROYAL", "L", 3, 3, 12.55],
  ["SU10700201", "Clasica", "BLANCO", "M", 3, 0, 6.25],
  ["SU10700601", "Clasica", "BLANCO", "3XL", 1, 0, 6.83],
  ["CA65020348", "Dogo Premium", "ROSA CLARO", "L", 1, 0, 2.39],
  ["CA65020201", "Dogo Premium", "BLANCO", "M", 10, 0, 2.39],
  ["CA65020601", "Dogo Premium", "BLANCO", "3XL", 2, 0, 2.52],
].map(([referencia, nombre, color, talla, cantidad, reservada, coste], i) => {
  const producto = {
    id: id("a1", i + 1),
    empresa_id: EMPRESA,
    marca: "Roly",
    referencia,
    nombre,
    categoria: null,
    activo: true,
  };
  return {
    id: id("a2", i + 1),
    empresa_id: EMPRESA,
    producto_id: producto.id,
    producto,
    nombre,
    sku: null,
    ean: null,
    categoria: null,
    talla,
    color,
    cantidad,
    cantidad_reservada: reservada,
    cantidad_minima: 0,
    coste_unitario: coste,
    precio_venta: 0,
    repetida: false,
    notas: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
});

const TEXTIL_PEDIDOS = [0, 1, 2].map((i) => {
  const subtotal = [90, 180, 45][i];
  const iva = subtotal * 0.21;
  return {
    id: id("t", i + 1),
    empresa_id: EMPRESA,
    numero: `TPD-2026-000${i + 1}`,
    fecha: fechaDia(3 + i).slice(0, 10),
    cliente_id: CLIENTES[i].id,
    cliente_nombre: CLIENTES[i].nombre,
    cliente_email: CLIENTES[i].email,
    marca_id: marca.id,
    marca,
    estado: ["pendiente", "en_produccion", "entregado"][i],
    metodo_pago: null,
    envio: 0,
    subtotal,
    iva,
    total: subtotal + iva,
    notas: null,
    tracking_empresa: null,
    tracking_numero: null,
    tracking_url: null,
    created_at: fechaDia(3 + i),
    updated_at: fechaDia(3 + i),
    items: [
      {
        id: id("t1", i + 1),
        pedido_id: id("t", i + 1),
        descripcion: "Camiseta técnica estampada",
        cantidad: 10 + i * 5,
        precio_unitario: 9,
        iva_pct: 21,
        subtotal,
        stock_id: STOCK[0].id,
      },
    ],
  };
});

const TEXTIL_COBROS = [
  {
    id: id("f9", 1),
    empresa_id: EMPRESA,
    pedido_id: null,
    textil_pedido_id: TEXTIL_PEDIDOS[2].id,
    fecha: TEXTIL_PEDIDOS[2].fecha,
    importe: TEXTIL_PEDIDOS[2].total,
    propina: 0,
    metodo: "efectivo",
    previo: false,
    automatico: false,
    notas: null,
    created_at: TEXTIL_PEDIDOS[2].created_at,
    pedido: {
      id: TEXTIL_PEDIDOS[2].id,
      numero: TEXTIL_PEDIDOS[2].numero,
      fecha: TEXTIL_PEDIDOS[2].fecha,
      cliente_nombre: TEXTIL_PEDIDOS[2].cliente_nombre,
      total: TEXTIL_PEDIDOS[2].total,
      iva: TEXTIL_PEDIDOS[2].iva,
      envio: 0,
    },
  },
];

const TEXTIL_PRESUPUESTOS = [0, 1].map((i) => ({
  id: id("q", i + 1),
  empresa_id: EMPRESA,
  numero: `PRES-2026-000${i + 1}`,
  fecha: fechaDia(1 + i).slice(0, 10),
  validez_dias: 30,
  cliente_id: CLIENTES[i].id,
  cliente_nombre: CLIENTES[i].nombre,
  cliente_email: CLIENTES[i].email,
  cliente_nif: null,
  cliente_direccion: null,
  marca_id: marca.id,
  marca,
  estado: ["enviado", "aceptado"][i],
  subtotal: 200,
  iva: 42,
  total: 242,
  notas: null,
  factura_id: null,
  pedido_id: i === 1 ? TEXTIL_PEDIDOS[0].id : null,
  pedido: i === 1 ? { numero: TEXTIL_PEDIDOS[0].numero } : null,
  created_at: fechaDia(1 + i),
  updated_at: fechaDia(1 + i),
  items: [
    {
      id: id("q1", i + 1),
      descripcion: "Sudadera capucha",
      cantidad: 10,
      precio_unitario: 20,
      iva_pct: 21,
      subtotal: 200,
      stock_id: STOCK[2].id,
    },
  ],
}));

const TEXTIL_FACTURAS = [0, 1].map((i) => ({
  id: id("r", i + 1),
  empresa_id: EMPRESA,
  numero: i === 0 ? "T2026/0007" : "2026/0004",
  serie: i === 0 ? "T" : "",
  ejercicio: 2026,
  numero_serie: i === 0 ? 7 : 4,
  tipo: i === 0 ? "simplificada" : "ordinaria",
  fecha: fechaDia(3 + i).slice(0, 10),
  vencimiento: null,
  cliente_id: CLIENTES[i].id,
  cliente_nombre: i === 0 ? null : CLIENTES[i].nombre,
  cliente_email: null,
  cliente_nif: i === 0 ? null : "B00000001",
  cliente_direccion: null,
  marca_id: marca.id,
  marca,
  estado: i === 0 ? "pagada" : "emitida",
  subtotal: 90,
  iva: 18.9,
  total: 108.9,
  desglose_iva: [{ tipo: 21, base: 90, cuota: 18.9 }],
  notas: null,
  pdf_path: null,
  rectifica_a_id: null,
  sustituye_a_id: null,
  textil_pedido_id: TEXTIL_PEDIDOS[i].id,
  created_at: fechaDia(3 + i),
  items: [],
}));

const COMPRAS = [0, 1].map((i) => ({
  id: id("k", i + 1),
  empresa_id: EMPRESA,
  proveedor: ["Proveedor Textil S.A.", "Distribuciones Algodón"][i],
  nif_proveedor: `A0000000${i}`,
  numero: `F-${100 + i}`,
  fecha: fechaDia(1 + i, 9).slice(0, 10),
  base: [300, 150][i],
  iva: [63, 31.5][i],
  total: [363, 181.5][i],
  estado: i === 0 ? "registrada" : "borrador",
  notas: null,
  created_at: fechaDia(1 + i, 9),
  categoria: "textil",
  irpf: 0,
  gasto_id: null,
  lineas: [],
}));
// Facturas de compra de todo el negocio (no textil).
// Lo que calcula la base en sus columnas generadas (20261014100000).
const calculada = (c, pagada = null) => {
  const r2 = (x) => Math.round(x * 100) / 100;
  const tipo_iva = c.base > 0 ? r2(c.iva / c.base) : 0.21;
  const tipo_irpf = c.base > 0 ? r2(c.irpf / c.base) : 0;
  const cuota_iva = r2(c.base * tipo_iva);
  const cuota_irpf = r2(c.base * tipo_irpf);
  return {
    ...c,
    tipo_iva,
    tipo_irpf,
    cuota_iva,
    cuota_irpf,
    total_calculado: r2(c.base + cuota_iva),
    liquido_calculado: r2(c.base + cuota_iva - cuota_irpf),
    liquido: r2(c.base + cuota_iva - cuota_irpf),
    liquido_origen: "calculado",
    nota_descuadre: null,
    concepto: null,
    forma_pago: pagada ? "transferencia" : null,
    estado_pago: pagada ? "pagada" : "pendiente",
    fecha_pago: pagada,
    borrada_en: null,
    ejercicio: c.fecha ? Number(c.fecha.slice(0, 4)) : null,
    trimestre: c.fecha ? Math.floor((Number(c.fecha.slice(5, 7)) - 1) / 3) + 1 : null,
  };
};
const compraGeneral = (n, proveedor, categoria, fecha, base, iva, irpf = 0, gasto_id = null) => ({
  id: id("k", 10 + n),
  empresa_id: EMPRESA,
  proveedor,
  nif_proveedor: `B1000000${n}`,
  numero: `C-${200 + n}`,
  fecha,
  base,
  iva,
  irpf,
  total: Math.round((base + iva - irpf) * 100) / 100,
  estado: "registrada",
  notas: null,
  created_at: `${fecha}T10:00:00Z`,
  categoria,
  gasto_id,
  lineas: [],
});
COMPRAS.push(
  compraGeneral(1, "Tintas DTF Pro", "consumibles", fechaDia(2).slice(0, 10), 90, 18.9),
  {
    ...compraGeneral(6, "Papelería Centro", "material", fechaDia(2).slice(0, 10), 40, 8.4),
    borrada_en: `${fechaDia(3)}`,
  },
  compraGeneral(2, "Impresoras Iberia", "maquinaria", "2026-06-15", 6000, 1260),
  compraGeneral(3, "Meta Platforms", "publicidad", fechaDia(3).slice(0, 10), 120, 25.2),
  compraGeneral(
    4,
    "Inmobiliaria Nave",
    "servicios",
    fechaDia(1).slice(0, 10),
    300,
    63,
    57,
    id("9f", 1),
  ),
  compraGeneral(5, "SEUR", "envios", fechaDia(4).slice(0, 10), 25, 5.25),
);
// Con los importes que calcula la base; la publicidad, ya pagada.
COMPRAS.forEach((c, i) => {
  COMPRAS[i] = {
    ...calculada(c, c.categoria === "publicidad" ? fechaDia(5).slice(0, 10) : null),
    borrada_en: c.borrada_en ?? null,
    revision: "revisada",
    revision_motivo: null,
    confianza: null,
    fichero_huella: null,
    fichero_ruta: null,
  };
});
// La cola: lo que ha leído la IA y nadie ha confirmado, y una que no se leyó.
COMPRAS.push(
  {
    ...calculada({
      ...compraGeneral(7, "Tintas DTF Pro", "consumibles", fechaDia(2).slice(0, 10), 90, 18.9),
      numero: null,
      nif_proveedor: "B10000001",
      estado: "borrador",
    }),
    revision: "pendiente",
    revision_motivo:
      "Posible duplicado de Tintas DTF Pro del 2026-10-02 (mismo proveedor, fecha e importe).\nLa IA duda: el número de factura no se lee.",
    confianza: 0.72,
    fichero_huella: "aa11",
    fichero_ruta: "ronoca/2026/cola-1.pdf",
    notas: "Fichero: tintas-octubre.pdf",
  },
  {
    ...calculada({
      ...compraGeneral(8, null, "otros", fechaDia(6).slice(0, 10), 0, 0),
      fecha: null,
      estado: "borrador",
    }),
    proveedor: null,
    revision: "error",
    revision_motivo:
      "La lectura no tiene la forma esperada: confianza está fuera de rango. (tras un reintento)",
    numero: null,
    confianza: null,
    fichero_huella: "bb22",
    fichero_ruta: "ronoca/2026/cola-2.pdf",
    notas: "Fichero: escaneo-borroso.jpg",
  },
);

// Seguimiento de los pedidos enviados o entregados: sale de 0 a 3 días
// después del pedido (Gerencia › Producción, días hasta el envío).
const ENLACES = PEDIDOS.filter((p) => ["enviado", "entregado"].includes(p.estado)).map((p, i) => {
  const enviado = new Date(p.fecha_pedido);
  enviado.setUTCDate(enviado.getUTCDate() + (i % 4));
  enviado.setUTCHours(16);
  return {
    id: id("e5", i + 1),
    pedido_id: p.id,
    transportista: "GLS",
    codigo_seguimiento: `GLS${1000 + i}`,
    url: null,
    estado: null,
    created_at: enviado.toISOString(),
    updated_at: enviado.toISOString(),
  };
});

// Salida del almacén del pedido textil entregado: su coste para el margen.
const MOVIMIENTOS_STOCK = [
  {
    id: id("5a", 1),
    empresa_id: EMPRESA,
    stock_id: STOCK[0].id,
    motivo: "venta",
    cantidad: -TEXTIL_PEDIDOS[2].items[0].cantidad,
    coste_unitario: STOCK[0].coste_unitario,
    textil_pedido_id: TEXTIL_PEDIDOS[2].id,
    nota: null,
    created_at: fechaDia(5),
  },
];

// Gerencia › Ajustes: un gasto fijo vigente, otro dado de baja y un objetivo.
const GASTOS_FIJOS = [
  {
    id: id("9f", 1),
    empresa_id: EMPRESA,
    concepto: "Alquiler nave",
    importe_mensual: 300,
    desde: "2026-01-01",
    hasta: null,
    notas: null,
    periodicidad: "mensual",
    tipo: "alquiler",
    iva_pct: 21,
    irpf_pct: 19,
  },
  {
    id: id("9f", 2),
    empresa_id: EMPRESA,
    concepto: "Gestoría",
    importe_mensual: 90,
    desde: "2026-01-01",
    hasta: "2026-06-30",
    notas: "Cambiamos de gestoría",
    periodicidad: "mensual",
    tipo: "profesional",
    iva_pct: 21,
    irpf_pct: 15,
  },
  {
    id: id("9f", 3),
    empresa_id: EMPRESA,
    concepto: "Seguro de la nave",
    importe_mensual: 240,
    desde: "2026-03-01",
    hasta: null,
    notas: null,
    periodicidad: "anual",
    tipo: "seguro",
    iva_pct: 0,
    irpf_pct: 0,
  },
  {
    id: id("9f", 4),
    empresa_id: EMPRESA,
    concepto: "Ayuda en el taller",
    importe_mensual: 150,
    desde: "2026-05-01",
    hasta: null,
    notas: null,
    periodicidad: "mensual",
    tipo: "otros",
    iva_pct: 0,
    irpf_pct: 0,
    con_justificante: false,
  },
].map((g) => ({ con_justificante: true, ...g }));
const OBJETIVOS = [
  { id: id("0b", 1), empresa_id: EMPRESA, desde: "2026-09-01", metros: 40, vendido: 1500 },
];

// ---------------------------------------------------------------------------
// Plantillas del PDF de presupuestos
// ---------------------------------------------------------------------------

// Un logo de prueba (PNG de 240 × 80, «T2 · Tienda Dos»), incrustado para que
// el banco no dependa de ningún servidor de imágenes. El Supabase de prueba no
// sirve los ficheros públicos del almacenamiento.
const LOGO_PRUEBA =
  "data:image/png;base64,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";

// Solo lo que cambia respecto a la de por defecto: el resto lo pone
// normalizarPlantilla al leerla, como con una plantilla vieja o a medias.
const PLANTILLAS_PRESUPUESTO = [
  {
    id: id("pp", 1),
    ambito: "tienda",
    tienda_id: TIENDA_2,
    empresa_id: EMPRESA,
    logo_url: LOGO_PRUEBA,
    config: {
      version: 1,
      colores: { principal: "#be123c", acento: "" },
      cabecera: {
        alto: 44,
        logo: { mostrar: true, x: 16, y: 12, ancho: 66, alto: 22 },
        titulo: { texto: "OFERTA", x: 194, y: 21, tamano: 22, alineacion: "derecha" },
        datos: { x: 128, y: 28 },
        texto: {
          mostrar: true,
          texto: "{web} · {telefono}",
          x: 16,
          y: 40,
          tamano: 8,
          alineacion: "izquierda",
        },
      },
      condiciones: { titulo: "Condiciones de la oferta" },
      pie: { texto: "{razon_social} · CIF {cif}\n{direccion}", alineacion: "centro" },
    },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
];

Object.assign(DATOS, {
  enlaces_seguimiento: ENLACES,
  textil_pedido_items: TEXTIL_PEDIDOS.flatMap((p) => p.items),
  textil_stock_movimientos: MOVIMIENTOS_STOCK,
  gerencia_ajustes: [
    {
      empresa_id: EMPRESA,
      web_sin_pagar_cuenta: true,
      tipo_is: 15,
      cuota_is_anterior: null,
      precio_metro: 7,
    },
  ],
  gerencia_gastos_fijos: GASTOS_FIJOS,
  gerencia_objetivos: OBJETIVOS,
  clientes: CLIENTES,
  clientes_posibles_duplicados: [],
  pedidos: PEDIDOS,
  pedido_items: PEDIDO_ITEMS,
  cobros: [...COBROS, ...TEXTIL_COBROS],
  pedidos_pendientes_cobro: PENDIENTES,
  facturas: FACTURAS,
  // Contadores de cada serie: la última de cada una se puede borrar.
  series_facturacion: [
    { empresa_id: EMPRESA, serie: "", ejercicio: 2026, ultimo_numero: 6, numero_inicial: 1 },
    { empresa_id: EMPRESA, serie: "T", ejercicio: 2026, ultimo_numero: 7, numero_inicial: 1 },
  ],
  productos: PRODUCTOS,
  presupuestos: PRESUPUESTOS,
  caja_socios: SOCIOS,
  caja_conceptos: CONCEPTOS,
  caja_movimientos: CAJA,
  inversion_movimientos: INVERSION,
  banco_movimientos: BANCO,
  banco_conciliaciones: CONCILIACIONES,
  banco_cuentas: CUENTAS_BANCO,
  banco_extractos: EXTRACTOS_BANCO,
  textil_marcas: MARCAS,
  textil_stock: [...STOCK, ...STOCK_ROLY],
  textil_productos: STOCK_ROLY.map((v) => v.producto),
  textil_pedidos: TEXTIL_PEDIDOS,
  textil_presupuestos: TEXTIL_PRESUPUESTOS,
  textil_facturas: TEXTIL_FACTURAS,
  textil_compras: COMPRAS,
  tienda_plantillas_correo: [],
  // Del PDF de presupuestos, solo la Tienda Dos tiene plantilla guardada; la
  // Tienda Uno y el textil salen con la de por defecto.
  plantillas_presupuesto: PLANTILLAS_PRESUPUESTO,
});

Object.assign(RPC, {
  serie_estado: () => [
    {
      tipo: "ordinaria",
      serie: "",
      ejercicio: 2026,
      numero_inicial: 1,
      ultimo_numero: 3,
      proximo_numero: 4,
      emitidas: 3,
      se_puede_fijar: false,
    },
    {
      tipo: "rectificativa",
      serie: "R",
      ejercicio: 2026,
      numero_inicial: 1,
      ultimo_numero: 0,
      proximo_numero: 1,
      emitidas: 0,
      se_puede_fijar: true,
    },
    {
      tipo: "simplificada",
      serie: "T",
      ejercicio: 2026,
      numero_inicial: 1,
      ultimo_numero: 3,
      proximo_numero: 4,
      emitidas: 3,
      se_puede_fijar: false,
    },
  ],
  tienda_credenciales_leer: () => [],
  smtp_estado: () => [],
});

// Las funciones de la conciliación (20261025100000), calculadas con los datos
// de arriba en cada llamada: lo pendiente, el historial y los recuentos.
const enlazado = (c) => c.factura_id ?? c.compra_id ?? c.textil_factura_id;
const movPlano = (m) => ({
  id: m.id,
  fecha: m.fecha,
  concepto: m.concepto,
  importe: m.importe,
  cuenta_id: m.cuenta_id,
});
const documentosBanco = () => [
  ...DATOS.textil_compras
    .filter((c) => c.estado === "registrada" && !c.borrada_en)
    .map((c) => ({
      tipo: "compra",
      id: c.id,
      fecha: c.fecha,
      importe: c.liquido ?? c.total,
      contraparte: c.proveedor,
      nif: c.nif_proveedor,
      serie: null,
      ejercicio: null,
      numero: c.numero,
      tipo_documento: c.tipo_documento ?? "factura",
    })),
  ...DATOS.facturas
    .filter((f) => ["emitida", "vencida"].includes(f.estado))
    .map((f) => ({
      tipo: "factura",
      id: f.id,
      fecha: f.fecha,
      importe: f.total,
      contraparte: f.cliente_nombre,
      nif: f.cliente_nif,
      serie: f.serie,
      ejercicio: f.ejercicio,
      numero: f.numero,
      tipo_documento: null,
    })),
  ...DATOS.textil_facturas
    .filter((f) => !["borrador", "anulada"].includes(f.estado))
    .map((f) => ({
      tipo: "textil",
      id: f.id,
      fecha: f.fecha,
      importe: f.total,
      contraparte: f.cliente_nombre,
      nif: f.cliente_nif,
      serie: f.serie,
      ejercicio: null,
      numero: f.numero,
      tipo_documento: null,
    })),
];
Object.assign(RPC, {
  banco_movimientos_por_conciliar: () => {
    const usados = new Set(DATOS.banco_conciliaciones.map((c) => c.movimiento_id));
    return DATOS.banco_movimientos
      .filter((m) => !m.traspaso_con && !usados.has(m.id))
      .map(movPlano);
  },
  banco_documentos_por_conciliar: () => {
    const usados = new Set(DATOS.banco_conciliaciones.map(enlazado));
    return documentosBanco().filter((d) => !usados.has(d.id));
  },
  banco_conciliacion_cuantos: () => {
    const grupos = (estado) =>
      new Set(DATOS.banco_conciliaciones.filter((c) => c.estado === estado).map((c) => c.grupo))
        .size;
    return [
      {
        revisar: grupos("revisar"),
        conciliados: grupos("conciliada"),
        traspasos: DATOS.banco_movimientos.filter((m) => m.traspaso_con && m.importe < 0).length,
      },
    ];
  },
  banco_enlaces: () => {
    const docs = new Map(documentosBanco().map((d) => [d.id, d]));
    const movs = new Map(DATOS.banco_movimientos.map((m) => [m.id, m]));
    const grupos = new Map();
    for (const c of DATOS.banco_conciliaciones) {
      const g = grupos.get(c.grupo) ?? { filas: [] };
      g.filas.push(c);
      grupos.set(c.grupo, g);
    }
    return [...grupos.entries()].map(([grupo, { filas }]) => {
      const ms = [...new Set(filas.map((f) => f.movimiento_id))].map((id) => movs.get(id));
      return {
        grupo,
        empresa_id: EMPRESA,
        estado: filas.some((f) => f.estado === "revisar") ? "revisar" : "conciliada",
        motivo: filas[0].motivo,
        diferencia: filas[0].diferencia,
        fecha: ms
          .map((m) => m.fecha)
          .sort()
          .at(-1),
        movimientos: ms.map(movPlano),
        documentos: [...new Set(filas.map(enlazado))].map((id) => docs.get(id)).filter(Boolean),
      };
    });
  },
});
