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

export const RPC = {};

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
  const subtotal = [30, 45.5, 120, 18.75, 260, 64, 12.4, 88, 310, 22, 75, 140, 33, 51][i];
  const envio = i % 3 === 0 ? 5.95 : 0;
  const iva = Math.round((subtotal + envio) * 0.21 * 100) / 100;
  const total = Math.round((subtotal + envio + iva) * 100) / 100;
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
    metros_total: Math.round((subtotal / 12) * 100) / 100,
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
    subtotal: p.subtotal,
    iva: p.iva,
    total: p.total,
    created_at: p.created_at,
    pedidos: { fecha_pedido: p.fecha_pedido, tienda_id: p.tienda_id, estado: p.estado },
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
  base_imponible: p.subtotal + p.envio,
  iva_total: p.iva,
  total: p.total,
  desglose_iva: [{ tipo: 21, base: p.subtotal + p.envio, cuota: p.iva }],
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

const BANCO = [0, 1, 2].map((i) => ({
  id: id("9", i + 1),
  empresa_id: EMPRESA,
  fecha: fechaDia(3 + i, 9).slice(0, 10),
  concepto: ["TRANSFERENCIA TALLERES PEREZ", "RECIBO LUZ", "BIZUM ANA LOPEZ"][i],
  importe: [154.88, -86.3, 45.38][i],
  huella: `h${i}`,
  origen: "extracto.csv",
  created_at: fechaDia(3 + i, 9),
  conciliacion: [],
  banco_conciliaciones: [],
}));

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
  lineas: [],
}));

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
  },
  {
    id: id("9f", 2),
    empresa_id: EMPRESA,
    concepto: "Gestoría",
    importe_mensual: 90,
    desde: "2026-01-01",
    hasta: "2026-06-30",
    notas: "Cambiamos de gestoría",
  },
];
const OBJETIVOS = [
  { id: id("0b", 1), empresa_id: EMPRESA, desde: "2026-09-01", metros: 40, vendido: 1500 },
];

Object.assign(DATOS, {
  enlaces_seguimiento: ENLACES,
  textil_pedido_items: TEXTIL_PEDIDOS.flatMap((p) => p.items),
  textil_stock_movimientos: MOVIMIENTOS_STOCK,
  gerencia_ajustes: [{ empresa_id: EMPRESA, web_sin_pagar_cuenta: true }],
  gerencia_gastos_fijos: GASTOS_FIJOS,
  gerencia_objetivos: OBJETIVOS,
  clientes: CLIENTES,
  clientes_posibles_duplicados: [],
  pedidos: PEDIDOS,
  pedido_items: PEDIDO_ITEMS,
  cobros: [...COBROS, ...TEXTIL_COBROS],
  pedidos_pendientes_cobro: PENDIENTES,
  facturas: FACTURAS,
  productos: PRODUCTOS,
  presupuestos: PRESUPUESTOS,
  caja_socios: SOCIOS,
  caja_conceptos: CONCEPTOS,
  caja_movimientos: CAJA,
  inversion_movimientos: INVERSION,
  banco_movimientos: BANCO,
  textil_marcas: MARCAS,
  textil_stock: STOCK,
  textil_pedidos: TEXTIL_PEDIDOS,
  textil_presupuestos: TEXTIL_PRESUPUESTOS,
  textil_facturas: TEXTIL_FACTURAS,
  textil_compras: COMPRAS,
  tienda_plantillas_correo: [],
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
