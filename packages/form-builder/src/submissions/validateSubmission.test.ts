import { APIError, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { defineCalcSource } from '../calc/registry'
import { validateSubmission } from './validateSubmission'

const makeReq = (form: Record<string, unknown>): PayloadRequest =>
	({
		payload: { findByID: async () => form },
		context: {},
		locale: 'en',
		i18n: { t: (key: string) => key },
		t: (key: string) => key,
		user: null,
	}) as unknown as PayloadRequest

describe('validateSubmission calc source outage', () => {
	it('surfaces a resolver failure as a 503 APIError, not a generic 500', async () => {
		const hook = validateSubmission({
			registry: new Map(),
			ruleRegistry: new Map(),
			calcSources: {
				broken: defineCalcSource({
					label: 'Broken',
					resolve: () => {
						throw new Error('pricing backend down')
					},
				}),
			},
		})
		const req = makeReq({
			id: 1,
			fields: [
				{
					blockType: 'calculation',
					name: 'rate',
					expression: { type: 'source', source: 'broken' },
				},
			],
		})
		const run = hook({
			data: { form: 1, values: [] },
			operation: 'create',
			req,
		} as never)
		await expect(run).rejects.toBeInstanceOf(APIError)
		await expect(run).rejects.toMatchObject({
			status: 503,
			message: 'formBuilder:calc.sourcesUnavailable',
		})
	})
})
