import { describe, expect, it, vi } from 'vitest'
import type { ActionRunArgs } from '../defineAction'
import { emailTeam } from './emailTeam'

const form = { id: 'form-1', title: 'Test Form' }
const submissionId = 'sub-1'
const locale = 'en'
const t = (key: string) => key

const baseArgs = (overrides: Partial<ActionRunArgs<Record<string, unknown>>> = {}) =>
	({
		form,
		submissionId,
		locale,
		t,
		descriptors: [],
		req: undefined,
		...overrides,
	}) as ActionRunArgs<Record<string, unknown>>

describe('emailTeam', () => {
	it('calls sendEmail with interpolated subject and body', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		const values = [
			{ field: 'name', value: 'Alice' },
			{ field: 'message', value: 'Hello there' },
		]

		await emailTeam.run(
			baseArgs({
				config: { to: 'team@example.com', subject: 'New from {{name}}', body: '{{message}}' },
				values,
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledOnce()
		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com',
			subject: 'New from Alice',
			html: 'Hello there',
		})
	})

	it('throws when "to" is missing', async () => {
		const sendEmail = vi.fn()
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await expect(
			emailTeam.run(
				baseArgs({
					config: { to: '', subject: 'Hi', body: 'body' },
					values: [],
					payload,
				})
			)
		).rejects.toThrow('missing "to"')
	})

	it('throws when payload has no sendEmail', async () => {
		const payload = {} as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await expect(
			emailTeam.run(
				baseArgs({
					config: { to: 'team@example.com', subject: 'Hi', body: 'body' },
					values: [],
					payload,
				})
			)
		).rejects.toThrow('no email adapter')
	})
})
