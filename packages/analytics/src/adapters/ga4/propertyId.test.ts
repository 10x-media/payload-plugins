import { describe, expect, it } from 'vitest'
import { validatePropertyId } from './propertyId'

const args = { req: { t: (key: string) => key } } as never

describe('validatePropertyId', () => {
	it.each([
		['blank', '', true],
		['spaces alone', '   ', true],
		['a property number', '564235994', true],
		['a number with spaces around it', '  564235994  ', true],
		['the API resource name', 'properties/564235994', 'analytics:providerErrorPropertyId'],
		['a measurement id', 'G-AB12CD34', 'analytics:providerErrorPropertyId'],
		['an account and property pair', 'a416247390p564235994', 'analytics:providerErrorPropertyId'],
	] as const)('%s', (_name, value, expected) => {
		expect(validatePropertyId(value, args)).toBe(expected)
	})
})
