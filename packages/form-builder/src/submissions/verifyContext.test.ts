import { APIError, type Payload, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { signFormContext } from '../context/formContext'
import { CONTEXT_KEY } from '../spam/constants'
import { verifyContext } from './verifyContext'

const req = {
	payload: { secret: 's3cret' } as Payload,
	i18n: { t: (key: string) => key },
} as unknown as PayloadRequest

const hook = verifyContext()
const run = (data: Record<string, unknown>, operation: 'create' | 'update' = 'create') =>
	hook({ data, operation, req } as never) as Promise<Record<string, unknown>>

const fieldsOf = (data: Record<string, unknown>): string[] =>
	(data.values as { field: string }[]).map((entry) => entry.field)

describe('verifyContext', () => {
	it('verifies a signed context, stamps it, and strips the reserved entry from answers', async () => {
		const token = signFormContext({ payload: req.payload, relationTo: 'people', value: 42 })
		const out = await run({
			values: [
				{ field: 'name', value: 'Jo' },
				{ field: CONTEXT_KEY, value: token },
			],
		})
		expect(out.context).toEqual({ relationTo: 'people', value: '42' })
		expect(fieldsOf(out)).toEqual(['name'])
	})

	it('rejects an invalid context rather than silently dropping it', async () => {
		await expect(run({ values: [{ field: CONTEXT_KEY, value: 'v1.bad.sig' }] })).rejects.toBeInstanceOf(
			APIError
		)
	})

	it('is a no-op when no context is present (a form on an ordinary page)', async () => {
		const out = await run({ values: [{ field: 'name', value: 'Jo' }] })
		expect(out.context).toBeUndefined()
		expect(fieldsOf(out)).toEqual(['name'])
	})

	it('does not verify on non-create operations', async () => {
		const out = await run({ values: [{ field: CONTEXT_KEY, value: 'whatever' }] }, 'update')
		expect(fieldsOf(out)).toContain(CONTEXT_KEY)
	})
})
