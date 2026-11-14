import { describe, expect, it } from 'vitest'
import { validateMeasurementId } from './measurementId'

const args = { req: { t: (key: string) => key } } as never

describe('validateMeasurementId', () => {
	it.each([
		['blank', '', true],
		['spaces only', '   ', true],
		['an id', 'G-AB12CD34', true],
		['an id with spaces around it', '  G-AB12CD34  ', true],
		['a space inside', 'G-AB12 CD34', 'analytics:providerErrorMeasurementId'],
		['markup', 'G-AB12CD34<script>', 'analytics:providerErrorMeasurementId'],
		['an underscore', 'G_AB12', 'analytics:providerErrorMeasurementId'],
	])('%s', (_name, value, expected) => {
		expect(validateMeasurementId(value, args)).toBe(expected)
	})
})
