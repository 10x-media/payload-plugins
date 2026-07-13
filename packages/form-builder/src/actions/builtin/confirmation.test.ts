import { describe, expect, it, vi } from 'vitest'
import type { SubmissionValue } from '../../submissions/types'
import { makeRenderBody } from '../body/serializeBody'
import type { ActionRunArgs } from '../defineAction'
import { confirmation } from './confirmation'

const form = { id: 'form-1' }
const submissionId = 'sub-1'
const locale = 'en'
const t = (key: string) => key

const baseArgs = (overrides: Partial<ActionRunArgs<Record<string, unknown>>> = {}) => {
	const values = (overrides.values ?? []) as SubmissionValue[]
	return {
		form,
		submissionId,
		locale,
		t,
		descriptors: [],
		renderBody: makeRenderBody({ values, descriptors: [] }),
		req: undefined,
		...overrides,
	} as ActionRunArgs<Record<string, unknown>>
}

describe('confirmation', () => {
	it('sends email to the resolved recipient with a legacy string body', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		const values = [
			{ field: 'email', value: 'user@example.com' },
			{ field: 'name', value: 'Bob' },
		]

		await confirmation.run(
			baseArgs({
				config: {
					toField: 'email',
					subject: 'Thanks {{name}}',
					body: 'Your submission is received.',
				},
				values,
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledOnce()
		expect(sendEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			subject: 'Thanks Bob',
			html: 'Your submission is received.',
		})
	})

	it('serializes a lexical body to interpolated HTML', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		const body = {
			root: {
				type: 'root',
				children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thanks {{name}}!' }] }],
			},
		}

		await confirmation.run(
			baseArgs({
				config: { toField: 'email', subject: 'Thanks', body },
				values: [
					{ field: 'email', value: 'user@example.com' },
					{ field: 'name', value: 'Bob' },
				],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			subject: 'Thanks',
			html: '<p>Thanks Bob!</p>',
		})
	})

	it('sends an empty html body when body is unset', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await confirmation.run(
			baseArgs({
				config: { toField: 'email', subject: 'Hi' },
				values: [{ field: 'email', value: 'user@example.com' }],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			subject: 'Hi',
			html: '',
		})
	})

	it('does not call sendEmail when the recipient field is empty', async () => {
		const sendEmail = vi.fn()
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		const values = [{ field: 'email', value: '' }]

		await confirmation.run(
			baseArgs({
				config: { toField: 'email', subject: 'Hi', body: 'body' },
				values,
				payload,
			})
		)

		expect(sendEmail).not.toHaveBeenCalled()
	})

	it('does not call sendEmail when the recipient field is missing', async () => {
		const sendEmail = vi.fn()
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await confirmation.run(
			baseArgs({
				config: { toField: 'email', subject: 'Hi', body: 'body' },
				values: [],
				payload,
			})
		)

		expect(sendEmail).not.toHaveBeenCalled()
	})

	it('does not call sendEmail when toField itself is empty', async () => {
		const sendEmail = vi.fn()
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await confirmation.run(
			baseArgs({
				config: { toField: '', subject: 'Hi', body: 'body' },
				values: [{ field: 'email', value: 'user@example.com' }],
				payload,
			})
		)

		expect(sendEmail).not.toHaveBeenCalled()
	})

	it('throws when a recipient is resolved but no email adapter is configured', async () => {
		const payload = {} as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await expect(
			confirmation.run(
				baseArgs({
					config: { toField: 'email', subject: 'Hi', body: 'body' },
					values: [{ field: 'email', value: 'user@example.com' }],
					payload,
				})
			)
		).rejects.toThrow()
	})
})
