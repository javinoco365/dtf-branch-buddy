# DTF Flow

Construye un **CRM completo de gestión de pedidos, contabilidad y facturación** para un negocio de impresión **DTF (Direct To Film) vendido por metros**. El sistema es **multi-empresa / multi-sucursal**: una misma cuenta gestiona varias tiendas, y cada tienda (sucursal) está conectada a su **propio WooCommerce** mediante credenciales API independientes.

### Stack técnico

- **Frontend:** React + Vite + TypeScript + Tailwind CSS.

- **Backend / base de datos / auth:** **Supabase** (PostgreSQL, Auth, Storage para PDFs, Edge Functions).

- **Gráficas:** Recharts.

- **Idioma de toda la interfaz:** **español** (formato de moneda EUR, fechas dd/mm/aaaa, IVA español).

- Las llamadas a la API de WooCommerce deben hacerse **desde Supabase Edge Functions** (nunca desde el navegador), para que las claves nunca viajen al cliente en claro.

### Concepto de arquitectura multi-sucursal (clave)

- Existe una entidad **Sucursal** (también llamada "empresa del grupo"). Ejemplos: "DTFTextil.es".

- Cada sucursal tiene: sus propios **datos fiscales**, sus **credenciales de WooCommerce** (URL, Consumer Key, Consumer Secret), su flag de **sincronización activa**, y de forma aislada sus propios **pedidos, presupuestos, facturas, clientes, catálogo y facturación**.

- En la barra lateral debe poder seleccionarse / verse cada sucursal con su propio sub-menú (Pedidos, Facturas, Facturación, Ajustes de esa sucursal).

- Toda la data debe filtrarse por `sucursal_id`. Aplica **Row Level Security (RLS)** en Supabase para que cada usuario solo vea las sucursales a las que pertenece.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://dtf-branch-buddy.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ebb87d64-fb9a-47c1-90b6-b45bcdf7fb66).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
