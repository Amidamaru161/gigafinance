import { describe, expect, it } from 'vitest'
import {
  asBoolean,
  asString,
  field,
  parseIntValue,
  parseNumber,
  requireBlock,
} from '@deepseek-ai/dsh-tool-moex'

const block = {
  columns: ['SECID', 'PRICE', 'ACTIVE', 'LOTSIZE'],
  data: [['SBER', '272,79', '1', '10']],
} as const

describe('parseNumber', () => {
  it('parses locale comma decimals and strips grouping spaces', () => {
    expect(parseNumber('272,79')).toBe(272.79)
    expect(parseNumber('2 215 862 480')).toBe(2215862480)
    expect(parseNumber('1 048 140')).toBe(1048140)
  })

  it('passes through finite JSON numbers', () => {
    expect(parseNumber(42)).toBe(42)
    expect(parseNumber(1.5)).toBe(1.5)
  })

  it('returns undefined for null, empty, blank, and non-numeric input', () => {
    expect(parseNumber(null)).toBeUndefined()
    expect(parseNumber(undefined)).toBeUndefined()
    expect(parseNumber('')).toBeUndefined()
    expect(parseNumber('   ')).toBeUndefined()
    expect(parseNumber('n/a')).toBeUndefined()
    expect(parseNumber('12abc')).toBeUndefined()
  })
})

describe('parseIntValue', () => {
  it('parses integer strings and numbers', () => {
    expect(parseIntValue('10')).toBe(10)
    expect(parseIntValue(10)).toBe(10)
  })

  it('returns undefined for fractional, null, or non-numeric input', () => {
    expect(parseIntValue('10,5')).toBeUndefined()
    expect(parseIntValue(null)).toBeUndefined()
    expect(parseIntValue('')).toBeUndefined()
    expect(parseIntValue('abc')).toBeUndefined()
  })
})

describe('asBoolean', () => {
  it('parses 1/0 encodings', () => {
    expect(asBoolean('1')).toBe(true)
    expect(asBoolean('0')).toBe(false)
    expect(asBoolean(1)).toBe(true)
    expect(asBoolean(0)).toBe(false)
    expect(asBoolean(true)).toBe(true)
    expect(asBoolean(false)).toBe(false)
  })

  it('returns undefined for unrecognized encodings', () => {
    expect(asBoolean(null)).toBeUndefined()
    expect(asBoolean('yes')).toBeUndefined()
    expect(asBoolean(2)).toBeUndefined()
  })
})

describe('asString', () => {
  it('trims strings and treats null/empty as absent', () => {
    expect(asString(' SBER ')).toBe('SBER')
    expect(asString(484)).toBe('484')
    expect(asString(null)).toBeUndefined()
    expect(asString('')).toBeUndefined()
    expect(asString('   ')).toBeUndefined()
  })
})

describe('field and requireBlock', () => {
  it('reads a cell by column name', () => {
    const row = block.data[0]
    expect(field(block, row, 'SECID')).toBe('SBER')
    expect(field(block, row, 'PRICE')).toBe('272,79')
    expect(field(block, row, 'MISSING')).toBeUndefined()
  })

  it('requires a named block and rejects an absent one', () => {
    expect(requireBlock({ securities: block }, 'securities')).toBe(block)
    expect(() => requireBlock({}, 'candles')).toThrow(/missing the "candles" block/)
  })
})
