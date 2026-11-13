/**
 * Columnar parsing helpers for the MOEX ISS envelope. They convert a block's
 * `columns`/`data` into field access and coerce the API's locale-formatted
 * scalars (comma decimals, `"1"`/`"0"` booleans, empty-string nulls) into typed
 * values. Pure helpers shared by every tool adapter.
 * @module @deepseek-ai/dsh-tool-moex/parse
 */

import { MoexError } from './client.ts'
import type { MoexBlock, MoexResponse } from './client.ts'

/**
 * The value at `column` in `row`, or `undefined` when the block lacks that column.
 * @param block - the block owning the column names.
 * @param row - one row array aligned to `block.columns`.
 * @param column - the column name to look up.
 * @returns the cell value, or `undefined` for an absent column or cell.
 */
export function field(block: MoexBlock, row: readonly unknown[], column: string): unknown {
  const index = block.columns.indexOf(column)
  return index === -1 ? undefined : row[index]
}

/**
 * Require one named block from the envelope.
 * @param response - the parsed ISS envelope.
 * @param name - the block name to require.
 * @returns the block, or throws {@link MoexError} when it is missing.
 */
export function requireBlock(response: MoexResponse, name: string): MoexBlock {
  const block = response[name]
  if (block === undefined) throw new MoexError(`MOEX response is missing the "${name}" block`, 'MOEX_BAD_RESPONSE')
  return block
}

/**
 * Coerce a scalar to a trimmed string, treating null/empty as absent.
 * @param value - the raw cell value.
 * @returns the trimmed string, or `undefined` for null, empty, or blank input.
 */
export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const s = String(value).trim()
  return s === '' ? undefined : s
}

/**
 * Parse a locale-formatted number (comma decimal separator, NBSP groups).
 * @param value - the raw cell value (string or JSON number).
 * @returns the finite number, or `undefined` for null, empty, or non-numeric input.
 */
export function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  if (normalized === '') return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parse an integer scalar; null, empty, and non-integer values are absent.
 * @param value - the raw cell value.
 * @returns the integer, or `undefined` when the cell is absent or fractional.
 */
export function parseIntValue(value: unknown): number | undefined {
  const parsed = parseNumber(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

/**
 * Parse ISS boolean encodings (`1`/`0`, `true`/`false`, numeric 1/0).
 * @param value - the raw cell value.
 * @returns the boolean, or `undefined` for an unrecognized encoding.
 */
export function asBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 0) return false
    if (value === 1) return true
    return undefined
  }
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (s === '1' || s === 'true' || s === 'TRUE') return true
  if (s === '0' || s === 'false' || s === 'FALSE') return false
  return undefined
}
