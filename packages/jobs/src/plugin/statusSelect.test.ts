import { describe, expect, it } from 'vitest'

import { CELL_INPUTS, withCellInputs } from './statusSelect'

const args = (select: unknown) => ({ select }) as never

describe('withCellInputs', () => {
	it('adds the cell inputs to an include-mode select', () => {
		const out = withCellInputs(undefined)(args({ jobTitle: true, queue: true })) as Record<
			string,
			boolean
		>
		expect(out.jobTitle).toBe(true)
		for (const name of CELL_INPUTS) {
			expect(out[name]).toBe(true)
		}
	})

	it('leaves an exclude-mode select and no select alone', () => {
		expect(withCellInputs(undefined)(args({ log: false }))).toBeUndefined()
		expect(withCellInputs(undefined)(args(undefined))).toBeUndefined()
	})

	it('builds on the collection’s own select', () => {
		const prior = () => ({ queue: true }) as never
		const out = withCellInputs(prior)(args({ jobTitle: true })) as Record<string, boolean>
		expect(out.queue).toBe(true)
		expect(out.jobTitle).toBeUndefined()
		expect(out.hasError).toBe(true)
	})
})
