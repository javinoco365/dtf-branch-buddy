-- ============================================================================
-- Niveles de usuario (1 de 4): los valores nuevos del enum app_role
-- ============================================================================
--
-- QUÉ HACE
--   app_role solo tenía 'admin'. Se añaden los otros dos niveles:
--
--     admin   todo, incluida la gestión de usuarios.
--     editor  ve todo, crea y modifica; no borra ni gestiona usuarios.
--     visor   solo ve: no crea, no cambia, no borra.
--
-- POR QUÉ VA SOLA
--   Un valor nuevo de un enum no se puede usar en la misma transacción que lo
--   añade (ALTER TYPE ... ADD VALUE). Lo que los usa (funciones, datos,
--   políticas) va en 20261031200100 y siguientes.
--
-- REVERSIBLE: no. Postgres no quita valores de un enum sin recrear el tipo, y
-- has_role(), user_roles y las políticas dependen de él. Dos valores que nadie
-- usa no hacen daño: ver supabase/reversiones/20261031200000_roles_niveles.sql.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'editor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'visor';
