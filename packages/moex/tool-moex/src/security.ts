/**
 * The model-facing `moex_security` tool: the reference profile of one MOEX
 * security. This module owns the schema, argument validation, description
 * mapping, and formatting; `MoexClient` owns the network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MoexClient } from './client.ts'
import type { MoexBlock } from './client.ts'
import { asBoolean, asString, field, parseIntValue, parseNumber, requireBlock } from './parse.ts'

/** Primary-board metadata carried by the `moex_security` output. */
export interface SecurityBoard {
  /** Board id, e.g. `TQBR`. */
  boardId: string
  /** Trading currency, e.g. `RUB`. */
  currency?: string
  /** Price decimals on this board. */
  decimals?: number
  /** Whether the security is traded on this board. */
  isTraded?: boolean
  /** First date with history on this board. */
  historyFrom?: string
  /** Last date with history on this board. */
  historyTill?: string
}

/** The canonical `moex_security` output value. */
export interface SecurityProfile {
  /** Stable MOEX security id. */
  secid: string
  /** Full security name. */
  name?: string
  /** Short display name. */
  shortname?: string
  /** ISIN code. */
  isin?: string
  /** State registration number. */
  regnumber?: string
  /** Issued quantity of units. */
  issueSize?: number
  /** Face value per unit. */
  faceValue?: number
  /** Face value currency. */
  faceUnit?: string
  /** First trading date. */
  issueDate?: string
  /** Human-readable instrument type, e.g. `Акция обыкновенная`. */
  typeName?: string
  /** Instrument group code, e.g. `stock_shares`. */
  group?: string
  /** Human-readable instrument group, e.g. `Акции`. */
  groupName?: string
  /** Instrument type code, e.g. `common_share`. */
  type?: string
  /** Listing level (1-3). */
  listLevel?: number
  /** MOEX issuer id, usable as a company key. */
  emitterId?: number
  /** Whether the security is restricted to qualified investors. */
  isQualifiedInvestors?: boolean
  /** Primary-board metadata, when the security lists a primary board. */
  board?: SecurityBoard
}

/**
 * Validate `moex_security` arguments: a non-blank `secid`.
 * @param args - the schema-validated arguments.
 * @returns the trimmed `secid`.
 */
export function parseSecurityArgs(args: { secid: string }): { secid: string } {
  if (args.secid.trim().length === 0) throw new Error('secid must be a non-empty string')
  return { secid: args.secid.trim() }
}

/** Read one `description` block field value by its `name` cell. */
function descriptionValue(block: MoexBlock, name: string): unknown {
  const nameIndex = block.columns.indexOf('name')
  const valueIndex = block.columns.indexOf('value')
  const row = block.data.find(r => r[nameIndex] === name)
  return row === undefined ? undefined : row[valueIndex]
}

/** Extract the primary board from a `boards` block, or `undefined` when absent. */
function primaryBoard(block: MoexBlock | undefined): SecurityBoard | undefined {
  if (block === undefined) return undefined
  const isPrimary = block.columns.indexOf('is_primary')
  const row = block.data.find(r => r[isPrimary] === 1)
  if (row === undefined) return undefined
  const boardId = asString(field(block, row, 'boardid')) ?? ''
  const currency = asString(field(block, row, 'currencyid'))
  const decimals = parseIntValue(field(block, row, 'decimals'))
  const isTraded = asBoolean(field(block, row, 'is_traded'))
  const historyFrom = asString(field(block, row, 'history_from'))
  const historyTill = asString(field(block, row, 'history_till'))
  return {
    boardId,
    ...currency !== undefined ? { currency } : {},
    ...decimals !== undefined ? { decimals } : {},
    ...isTraded !== undefined ? { isTraded } : {},
    ...historyFrom !== undefined ? { historyFrom } : {},
    ...historyTill !== undefined ? { historyTill } : {},
  }
}

/**
 * Format a security profile as one model-facing text block.
 * @param profile - the canonical `moex_security` output value.
 * @returns the `Field: value` listing plus primary-board metadata.
 */
export function formatSecurityOutput(profile: SecurityProfile): string {
  const lines: string[] = [`SECID: ${profile.secid}`]
  const add = (label: string, value: string | number | undefined): void => {
    if (value !== undefined) lines.push(`${label}: ${value}`)
  }
  add('Name', profile.name)
  add('Short name', profile.shortname)
  add('ISIN', profile.isin)
  add('Registration number', profile.regnumber)
  add('Issue size', profile.issueSize)
  add('Face value', profile.faceValue)
  add('Face currency', profile.faceUnit)
  add('First trading date', profile.issueDate)
  add('Type', profile.typeName ?? profile.type)
  add('Group', profile.groupName ?? profile.group)
  add('Listing level', profile.listLevel)
  add('Issuer id', profile.emitterId)
  add('Qualified investors only', profile.isQualifiedInvestors === true ? 'yes' : profile.isQualifiedInvestors === false ? 'no' : undefined)
  if (profile.board !== undefined) {
    lines.push('Primary board:')
    lines.push(`  Board: ${profile.board.boardId}`)
    add('  Currency', profile.board.currency)
    add('  Decimals', profile.board.decimals)
    add('  Traded', profile.board.isTraded === true ? 'yes' : profile.board.isTraded === false ? 'no' : undefined)
    add('  History from', profile.board.historyFrom)
    add('  History till', profile.board.historyTill)
  }
  return lines.join('\n')
}

/**
 * Register the `moex_security` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param client - the shared MOEX ISS client.
 * @param timeoutMs - the cooperative tool-call budget attached as `timeoutMs`.
 */
export function applySecurityTool(ctx: Context, client: MoexClient, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:moex_security',
    order: 118,
    text: 'Use the moex_security tool to read the reference profile of one MOEX security by its SECID (for example one returned by moex_securities). It reports the name, ISIN, instrument type, issue size, face value, listing level, and primary-board metadata.',
  })

  ctx.tools.register(defineTool({
    name: 'moex_security',
    description: 'Read the reference profile of one MOEX security (name, ISIN, type, issue size, face value, listing level, primary board).',
    parameters: {
      secid: { type: 'string', required: true, description: 'The MOEX security id (SECID), e.g. SBER.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          secid: { type: 'string', required: true },
          name: { type: 'string' },
          shortname: { type: 'string' },
          isin: { type: 'string' },
          regnumber: { type: 'string' },
          issueSize: { type: 'number' },
          faceValue: { type: 'number' },
          faceUnit: { type: 'string' },
          issueDate: { type: 'string' },
          typeName: { type: 'string' },
          group: { type: 'string' },
          groupName: { type: 'string' },
          type: { type: 'string' },
          listLevel: { type: 'integer' },
          emitterId: { type: 'integer' },
          isQualifiedInvestors: { type: 'boolean' },
          board: {
            type: 'object',
            additionalProperties: false,
            properties: {
              boardId: { type: 'string', required: true },
              currency: { type: 'string' },
              decimals: { type: 'integer' },
              isTraded: { type: 'boolean' },
              historyFrom: { type: 'string' },
              historyTill: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSecurityOutput(value) }],
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseSecurityArgs(args)
      const response = await client.get(
        `/securities/${input.secid}.json`,
        { 'iss.meta': 'off' },
        exec.signal,
      )
      const description = requireBlock(response, 'description')
      const name = asString(descriptionValue(description, 'NAME'))
      const shortname = asString(descriptionValue(description, 'SHORTNAME'))
      const isin = asString(descriptionValue(description, 'ISIN'))
      const regnumber = asString(descriptionValue(description, 'REGNUMBER'))
      const issueSize = parseNumber(descriptionValue(description, 'ISSUESIZE'))
      const faceValue = parseNumber(descriptionValue(description, 'FACEVALUE'))
      const faceUnit = asString(descriptionValue(description, 'FACEUNIT'))
      const issueDate = asString(descriptionValue(description, 'ISSUEDATE'))
      const typeName = asString(descriptionValue(description, 'TYPENAME'))
      const group = asString(descriptionValue(description, 'GROUP'))
      const groupName = asString(descriptionValue(description, 'GROUPNAME'))
      const type = asString(descriptionValue(description, 'TYPE'))
      const listLevel = parseIntValue(descriptionValue(description, 'LISTLEVEL'))
      const emitterId = parseIntValue(descriptionValue(description, 'EMITTER_ID'))
      const isQualifiedInvestors = asBoolean(descriptionValue(description, 'ISQUALIFIEDINVESTORS'))
      const board = primaryBoard(response['boards'])
      return {
        secid: input.secid.toUpperCase(),
        ...name !== undefined ? { name } : {},
        ...shortname !== undefined ? { shortname } : {},
        ...isin !== undefined ? { isin } : {},
        ...regnumber !== undefined ? { regnumber } : {},
        ...issueSize !== undefined ? { issueSize } : {},
        ...faceValue !== undefined ? { faceValue } : {},
        ...faceUnit !== undefined ? { faceUnit } : {},
        ...issueDate !== undefined ? { issueDate } : {},
        ...typeName !== undefined ? { typeName } : {},
        ...group !== undefined ? { group } : {},
        ...groupName !== undefined ? { groupName } : {},
        ...type !== undefined ? { type } : {},
        ...listLevel !== undefined ? { listLevel } : {},
        ...emitterId !== undefined ? { emitterId } : {},
        ...isQualifiedInvestors !== undefined ? { isQualifiedInvestors } : {},
        ...board !== undefined ? { board } : {},
      }
    },
  }))
}
