export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clientes: {
        Row: {
          ciudad: string | null
          codigo_postal: string | null
          created_at: string
          direccion: string | null
          email: string | null
          empresa: string | null
          id: string
          nif: string | null
          nombre: string
          notas: string | null
          pais: string | null
          provincia: string | null
          telefono: string | null
          tienda_id: string
          updated_at: string
          woo_customer_id: number | null
        }
        Insert: {
          ciudad?: string | null
          codigo_postal?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nif?: string | null
          nombre: string
          notas?: string | null
          pais?: string | null
          provincia?: string | null
          telefono?: string | null
          tienda_id: string
          updated_at?: string
          woo_customer_id?: number | null
        }
        Update: {
          ciudad?: string | null
          codigo_postal?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nif?: string | null
          nombre?: string
          notas?: string | null
          pais?: string | null
          provincia?: string | null
          telefono?: string | null
          tienda_id?: string
          updated_at?: string
          woo_customer_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_global: {
        Row: {
          cif: string | null
          ciudad: string | null
          codigo_postal: string | null
          coste_consumibles_metro: number
          coste_electricidad_metro: number
          coste_packaging_metro: number
          created_at: string
          direccion: string | null
          email_fiscal: string | null
          id: boolean
          pais: string | null
          provincia: string | null
          razon_social: string | null
          telefono: string | null
          textil_marca_predeterminada_id: string | null
          updated_at: string
        }
        Insert: {
          cif?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          coste_consumibles_metro?: number
          coste_electricidad_metro?: number
          coste_packaging_metro?: number
          created_at?: string
          direccion?: string | null
          email_fiscal?: string | null
          id?: boolean
          pais?: string | null
          provincia?: string | null
          razon_social?: string | null
          telefono?: string | null
          textil_marca_predeterminada_id?: string | null
          updated_at?: string
        }
        Update: {
          cif?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          coste_consumibles_metro?: number
          coste_electricidad_metro?: number
          coste_packaging_metro?: number
          created_at?: string
          direccion?: string | null
          email_fiscal?: string | null
          id?: boolean
          pais?: string | null
          provincia?: string | null
          razon_social?: string | null
          telefono?: string | null
          textil_marca_predeterminada_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_global_textil_marca_predeterminada_id_fkey"
            columns: ["textil_marca_predeterminada_id"]
            isOneToOne: false
            referencedRelation: "textil_marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      enlaces_seguimiento: {
        Row: {
          codigo_seguimiento: string | null
          created_at: string
          estado: string | null
          id: string
          pedido_id: string
          transportista: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          codigo_seguimiento?: string | null
          created_at?: string
          estado?: string | null
          id?: string
          pedido_id: string
          transportista?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          codigo_seguimiento?: string | null
          created_at?: string
          estado?: string | null
          id?: string
          pedido_id?: string
          transportista?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enlaces_seguimiento_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      factura_items: {
        Row: {
          cantidad: number
          created_at: string
          descripcion: string
          factura_id: string
          id: string
          iva: number
          iva_rate: number
          precio_unitario: number
          subtotal: number
          total: number
          unidad: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          descripcion: string
          factura_id: string
          id?: string
          iva?: number
          iva_rate?: number
          precio_unitario?: number
          subtotal?: number
          total?: number
          unidad?: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          descripcion?: string
          factura_id?: string
          id?: string
          iva?: number
          iva_rate?: number
          precio_unitario?: number
          subtotal?: number
          total?: number
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "factura_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas: {
        Row: {
          base_imponible: number
          cliente_direccion: string | null
          cliente_id: string | null
          cliente_nif: string | null
          cliente_nombre: string | null
          created_at: string
          emisor_cif: string | null
          emisor_direccion: string | null
          emisor_nombre: string | null
          estado: Database["public"]["Enums"]["factura_estado"]
          fecha: string
          fecha_vencimiento: string | null
          id: string
          iva_total: number
          notas: string | null
          numero: number
          pdf_url: string | null
          pedido_id: string | null
          serie: string
          tienda_id: string
          total: number
          updated_at: string
        }
        Insert: {
          base_imponible?: number
          cliente_direccion?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          emisor_cif?: string | null
          emisor_direccion?: string | null
          emisor_nombre?: string | null
          estado?: Database["public"]["Enums"]["factura_estado"]
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          iva_total?: number
          notas?: string | null
          numero: number
          pdf_url?: string | null
          pedido_id?: string | null
          serie?: string
          tienda_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          base_imponible?: number
          cliente_direccion?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          emisor_cif?: string | null
          emisor_direccion?: string | null
          emisor_nombre?: string | null
          estado?: Database["public"]["Enums"]["factura_estado"]
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          iva_total?: number
          notas?: string | null
          numero?: number
          pdf_url?: string | null
          pedido_id?: string | null
          serie?: string
          tienda_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_devoluciones: {
        Row: {
          created_at: string
          fecha: string
          id: string
          importe: number
          motivo: string | null
          pedido_id: string
          tienda_id: string
          updated_at: string
          woo_refund_id: number | null
        }
        Insert: {
          created_at?: string
          fecha?: string
          id?: string
          importe?: number
          motivo?: string | null
          pedido_id: string
          tienda_id: string
          updated_at?: string
          woo_refund_id?: number | null
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          importe?: number
          motivo?: string | null
          pedido_id?: string
          tienda_id?: string
          updated_at?: string
          woo_refund_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_devoluciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devoluciones_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_items: {
        Row: {
          cantidad: number
          created_at: string
          descripcion: string
          id: string
          iva: number
          iva_rate: number
          pedido_id: string
          precio_unitario: number
          producto_id: string | null
          subtotal: number
          total: number
          unidad: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          descripcion: string
          id?: string
          iva?: number
          iva_rate?: number
          pedido_id: string
          precio_unitario?: number
          producto_id?: string | null
          subtotal?: number
          total?: number
          unidad?: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          descripcion?: string
          id?: string
          iva?: number
          iva_rate?: number
          pedido_id?: string
          precio_unitario?: number
          producto_id?: string | null
          subtotal?: number
          total?: number
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          cliente_email: string | null
          cliente_id: string | null
          cliente_nombre: string | null
          created_at: string
          envio: number
          estado: Database["public"]["Enums"]["pedido_estado"]
          fecha_entrega: string | null
          fecha_pedido: string
          id: string
          iva: number
          metodo_pago: string | null
          metros_total: number
          notas: string | null
          numero: string
          origen: string | null
          subtotal: number
          tienda_id: string
          total: number
          updated_at: string
          woo_order_id: number | null
        }
        Insert: {
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          created_at?: string
          envio?: number
          estado?: Database["public"]["Enums"]["pedido_estado"]
          fecha_entrega?: string | null
          fecha_pedido?: string
          id?: string
          iva?: number
          metodo_pago?: string | null
          metros_total?: number
          notas?: string | null
          numero: string
          origen?: string | null
          subtotal?: number
          tienda_id: string
          total?: number
          updated_at?: string
          woo_order_id?: number | null
        }
        Update: {
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          created_at?: string
          envio?: number
          estado?: Database["public"]["Enums"]["pedido_estado"]
          fecha_entrega?: string | null
          fecha_pedido?: string
          id?: string
          iva?: number
          metodo_pago?: string | null
          metros_total?: number
          notas?: string | null
          numero?: string
          origen?: string | null
          subtotal?: number
          tienda_id?: string
          total?: number
          updated_at?: string
          woo_order_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          created_at: string
          descripcion: string | null
          id: string
          iva_rate: number
          nombre: string
          precio_unitario: number
          sku: string | null
          tienda_id: string
          unidad: string
          updated_at: string
          woo_product_id: number | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          id?: string
          iva_rate?: number
          nombre: string
          precio_unitario?: number
          sku?: string | null
          tienda_id: string
          unidad?: string
          updated_at?: string
          woo_product_id?: number | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          id?: string
          iva_rate?: number
          nombre?: string
          precio_unitario?: number
          sku?: string | null
          tienda_id?: string
          unidad?: string
          updated_at?: string
          woo_product_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      proyectos: {
        Row: {
          cliente_nombre: string | null
          created_at: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["proyecto_estado"]
          fecha_prevista: string | null
          id: string
          nombre: string
          notas: string | null
          prioridad: Database["public"]["Enums"]["proyecto_prioridad"]
          tienda_id: string | null
          updated_at: string
        }
        Insert: {
          cliente_nombre?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["proyecto_estado"]
          fecha_prevista?: string | null
          id?: string
          nombre: string
          notas?: string | null
          prioridad?: Database["public"]["Enums"]["proyecto_prioridad"]
          tienda_id?: string | null
          updated_at?: string
        }
        Update: {
          cliente_nombre?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["proyecto_estado"]
          fecha_prevista?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          prioridad?: Database["public"]["Enums"]["proyecto_prioridad"]
          tienda_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proyectos_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_clientes: {
        Row: {
          created_at: string
          direccion: string | null
          email: string | null
          id: string
          nif: string | null
          nombre: string
          notas: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nif?: string | null
          nombre: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nif?: string | null
          nombre?: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      textil_factura_items: {
        Row: {
          cantidad: number
          created_at: string
          descripcion: string
          factura_id: string
          id: string
          iva_pct: number
          precio_unitario: number
          subtotal: number
        }
        Insert: {
          cantidad?: number
          created_at?: string
          descripcion: string
          factura_id: string
          id?: string
          iva_pct?: number
          precio_unitario?: number
          subtotal?: number
        }
        Update: {
          cantidad?: number
          created_at?: string
          descripcion?: string
          factura_id?: string
          id?: string
          iva_pct?: number
          precio_unitario?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "textil_factura_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "textil_facturas"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_facturas: {
        Row: {
          cliente_direccion: string | null
          cliente_email: string | null
          cliente_id: string | null
          cliente_nif: string | null
          cliente_nombre: string | null
          created_at: string
          estado: string
          fecha: string
          id: string
          iva: number
          marca_id: string | null
          metodo_pago: string | null
          notas: string | null
          numero: string
          pdf_path: string | null
          presupuesto_id: string | null
          serie: string | null
          subtotal: number
          total: number
          updated_at: string
          vencimiento: string | null
        }
        Insert: {
          cliente_direccion?: string | null
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          metodo_pago?: string | null
          notas?: string | null
          numero: string
          pdf_path?: string | null
          presupuesto_id?: string | null
          serie?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          vencimiento?: string | null
        }
        Update: {
          cliente_direccion?: string | null
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          metodo_pago?: string | null
          notas?: string | null
          numero?: string
          pdf_path?: string | null
          presupuesto_id?: string | null
          serie?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          vencimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "textil_facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "textil_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_facturas_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "textil_marcas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_facturas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "textil_presupuestos"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_marcas: {
        Row: {
          activa: boolean
          color: string | null
          created_at: string
          direccion: string | null
          email: string | null
          id: string
          logo_url: string | null
          nombre: string
          notas: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activa?: boolean
          color?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          nombre: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activa?: boolean
          color?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          nombre?: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      textil_pedido_items: {
        Row: {
          cantidad: number
          created_at: string
          descripcion: string
          id: string
          iva_pct: number
          pedido_id: string
          precio_unitario: number
          stock_id: string | null
          subtotal: number
        }
        Insert: {
          cantidad?: number
          created_at?: string
          descripcion: string
          id?: string
          iva_pct?: number
          pedido_id: string
          precio_unitario?: number
          stock_id?: string | null
          subtotal?: number
        }
        Update: {
          cantidad?: number
          created_at?: string
          descripcion?: string
          id?: string
          iva_pct?: number
          pedido_id?: string
          precio_unitario?: number
          stock_id?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "textil_pedido_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "textil_pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_pedido_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "textil_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_pedidos: {
        Row: {
          cliente_email: string | null
          cliente_id: string | null
          cliente_nombre: string | null
          created_at: string
          envio: number
          estado: string
          fecha: string
          id: string
          iva: number
          marca_id: string | null
          metodo_pago: string | null
          notas: string | null
          numero: string
          subtotal: number
          total: number
          tracking_empresa: string | null
          tracking_numero: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          created_at?: string
          envio?: number
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          metodo_pago?: string | null
          notas?: string | null
          numero: string
          subtotal?: number
          total?: number
          tracking_empresa?: string | null
          tracking_numero?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          created_at?: string
          envio?: number
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          metodo_pago?: string | null
          notas?: string | null
          numero?: string
          subtotal?: number
          total?: number
          tracking_empresa?: string | null
          tracking_numero?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "textil_pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "textil_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_pedidos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "textil_marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_presupuesto_items: {
        Row: {
          cantidad: number
          created_at: string
          descripcion: string
          id: string
          iva_pct: number
          precio_unitario: number
          presupuesto_id: string
          stock_id: string | null
          subtotal: number
        }
        Insert: {
          cantidad?: number
          created_at?: string
          descripcion: string
          id?: string
          iva_pct?: number
          precio_unitario?: number
          presupuesto_id: string
          stock_id?: string | null
          subtotal?: number
        }
        Update: {
          cantidad?: number
          created_at?: string
          descripcion?: string
          id?: string
          iva_pct?: number
          precio_unitario?: number
          presupuesto_id?: string
          stock_id?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "textil_presupuesto_items_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "textil_presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_presupuesto_items_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "textil_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_presupuestos: {
        Row: {
          cliente_direccion: string | null
          cliente_email: string | null
          cliente_id: string | null
          cliente_nif: string | null
          cliente_nombre: string | null
          created_at: string
          estado: Database["public"]["Enums"]["textil_presupuesto_estado"]
          factura_id: string | null
          fecha: string
          id: string
          iva: number
          marca_id: string | null
          notas: string | null
          numero: string
          subtotal: number
          total: number
          updated_at: string
          validez_dias: number
        }
        Insert: {
          cliente_direccion?: string | null
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["textil_presupuesto_estado"]
          factura_id?: string | null
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          notas?: string | null
          numero: string
          subtotal?: number
          total?: number
          updated_at?: string
          validez_dias?: number
        }
        Update: {
          cliente_direccion?: string | null
          cliente_email?: string | null
          cliente_id?: string | null
          cliente_nif?: string | null
          cliente_nombre?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["textil_presupuesto_estado"]
          factura_id?: string | null
          fecha?: string
          id?: string
          iva?: number
          marca_id?: string | null
          notas?: string | null
          numero?: string
          subtotal?: number
          total?: number
          updated_at?: string
          validez_dias?: number
        }
        Relationships: [
          {
            foreignKeyName: "textil_presupuestos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "textil_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_presupuestos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "textil_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "textil_presupuestos_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "textil_marcas"
            referencedColumns: ["id"]
          },
        ]
      }
      textil_stock: {
        Row: {
          cantidad: number
          cantidad_minima: number
          categoria: string | null
          color: string | null
          coste_unitario: number
          created_at: string
          id: string
          nombre: string
          notas: string | null
          precio_venta: number
          sku: string | null
          talla: string | null
          updated_at: string
        }
        Insert: {
          cantidad?: number
          cantidad_minima?: number
          categoria?: string | null
          color?: string | null
          coste_unitario?: number
          created_at?: string
          id?: string
          nombre: string
          notas?: string | null
          precio_venta?: number
          sku?: string | null
          talla?: string | null
          updated_at?: string
        }
        Update: {
          cantidad?: number
          cantidad_minima?: number
          categoria?: string | null
          color?: string | null
          coste_unitario?: number
          created_at?: string
          id?: string
          nombre?: string
          notas?: string | null
          precio_venta?: number
          sku?: string | null
          talla?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tienda_credenciales: {
        Row: {
          consumer_key: string
          consumer_secret: string
          tienda_id: string
          updated_at: string
        }
        Insert: {
          consumer_key: string
          consumer_secret: string
          tienda_id: string
          updated_at?: string
        }
        Update: {
          consumer_key?: string
          consumer_secret?: string
          tienda_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tienda_credenciales_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: true
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      tienda_seguimiento_config: {
        Row: {
          activo: boolean
          api_key_ref: string | null
          codigo_cuenta: string | null
          created_at: string
          id: string
          tienda_id: string
          tracking_url_template: string | null
          transportista: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          api_key_ref?: string | null
          codigo_cuenta?: string | null
          created_at?: string
          id?: string
          tienda_id: string
          tracking_url_template?: string | null
          transportista?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          api_key_ref?: string | null
          codigo_cuenta?: string | null
          created_at?: string
          id?: string
          tienda_id?: string
          tracking_url_template?: string | null
          transportista?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tienda_seguimiento_config_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: true
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      tienda_usuarios: {
        Row: {
          created_at: string
          tienda_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          tienda_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          tienda_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tienda_usuarios_tienda_id_fkey"
            columns: ["tienda_id"]
            isOneToOne: false
            referencedRelation: "tiendas"
            referencedColumns: ["id"]
          },
        ]
      }
      tiendas: {
        Row: {
          cif: string | null
          ciudad: string | null
          codigo_postal: string | null
          color: string | null
          created_at: string
          created_by: string | null
          direccion: string | null
          email_fiscal: string | null
          gastos_envio_default: number
          id: string
          iva_default: number
          logo_url: string | null
          nombre: string
          pais: string | null
          provincia: string | null
          razon_social: string | null
          serie_factura: string
          siguiente_numero_factura: number
          slug: string | null
          sync_enabled: boolean
          telefono: string | null
          updated_at: string
          woo_url: string | null
        }
        Insert: {
          cif?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          direccion?: string | null
          email_fiscal?: string | null
          gastos_envio_default?: number
          id?: string
          iva_default?: number
          logo_url?: string | null
          nombre: string
          pais?: string | null
          provincia?: string | null
          razon_social?: string | null
          serie_factura?: string
          siguiente_numero_factura?: number
          slug?: string | null
          sync_enabled?: boolean
          telefono?: string | null
          updated_at?: string
          woo_url?: string | null
        }
        Update: {
          cif?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          direccion?: string | null
          email_fiscal?: string | null
          gastos_envio_default?: number
          id?: string
          iva_default?: number
          logo_url?: string | null
          nombre?: string
          pais?: string | null
          provincia?: string | null
          razon_social?: string | null
          serie_factura?: string
          siguiente_numero_factura?: number
          slug?: string | null
          sync_enabled?: boolean
          telefono?: string | null
          updated_at?: string
          woo_url?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_tienda_member: {
        Args: { _tienda_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
      factura_estado: "borrador" | "emitida" | "pagada" | "vencida" | "anulada"
      pedido_estado:
        | "pendiente"
        | "en_produccion"
        | "imprimiendo"
        | "listo"
        | "enviado"
        | "entregado"
        | "cancelado"
      proyecto_estado: "planificado" | "en_curso" | "completado" | "cancelado"
      proyecto_prioridad: "baja" | "media" | "alta"
      textil_presupuesto_estado:
        | "borrador"
        | "enviado"
        | "aceptado"
        | "rechazado"
        | "facturado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      factura_estado: ["borrador", "emitida", "pagada", "vencida", "anulada"],
      pedido_estado: [
        "pendiente",
        "en_produccion",
        "imprimiendo",
        "listo",
        "enviado",
        "entregado",
        "cancelado",
      ],
      proyecto_estado: ["planificado", "en_curso", "completado", "cancelado"],
      proyecto_prioridad: ["baja", "media", "alta"],
      textil_presupuesto_estado: [
        "borrador",
        "enviado",
        "aceptado",
        "rechazado",
        "facturado",
      ],
    },
  },
} as const
