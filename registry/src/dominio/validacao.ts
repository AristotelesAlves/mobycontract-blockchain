/**
 * Primitivas de validacao reutilizadas por todos os DTO de entrada.
 *
 * Ficam no dominio, e nao na camada HTTP, porque o formato aceito e regra de
 * negocio: e o mesmo contrato em qualquer transporte.
 */

import { z } from "zod";

export const ENDERECO = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "endereco invalido");

export const HASH = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "hash deve ser 32 bytes em hexadecimal");

export const IDENTIFICADOR = z.string().min(1).max(64);

export const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser AAAA-MM-DD");

export const CENTAVOS = z.string().regex(/^\d+$/, "valor deve ser inteiro em centavos");