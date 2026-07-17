import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { SubmissionValue } from '../../submissions/types'
import { makeRenderBody } from '../body/serializeBody'
import type { ActionRunArgs } from '../defineAction'
import { buildConfirmation, confirmation, validateToField } from './confirmation'

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
		renderBody: makeRenderBody({ values, descriptors: [], form }),
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

	it('omits from from sendEmail when config.from is unset', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await confirmation.run(
			baseArgs({
				config: { toField: 'email', subject: 'Hi', body: 'body' },
				values: [{ field: 'email', value: 'user@example.com' }],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			subject: 'Hi',
			html: 'body',
		})
	})

	it('includes from in sendEmail when config.from is set', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof confirmation.run>[0]['payload']

		await confirmation.run(
			baseArgs({
				config: {
					toField: 'email',
					from: 'Support <support@example.com>',
					subject: 'Hi',
					body: 'body',
				},
				values: [{ field: 'email', value: 'user@example.com' }],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'user@example.com',
			subject: 'Hi',
			html: 'body',
			from: 'Support <support@example.com>',
		})
	})

	const bodyFieldOf = (definition: ReturnType<typeof buildConfirmation>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'body') as
			| { editor?: unknown }
			| undefined

	it('omits editor from the body field by default', () => {
		expect(bodyFieldOf(buildConfirmation(true))?.editor).toBeUndefined()
	})

	it('spreads a custom editor onto the body field when given', () => {
		const editor = { fake: 'editor' } as never
		expect(bodyFieldOf(buildConfirmation(true, editor))?.editor).toBe(editor)
	})

	const fromFieldOf = (definition: ReturnType<typeof buildConfirmation>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'from')

	it('omits the from field when no fromAddresses resolver is given', () => {
		expect(fromFieldOf(buildConfirmation(true))).toBeUndefined()
	})

	it('adds a from field backed by the from-addresses endpoint when a resolver is given', () => {
		const field = fromFieldOf(buildConfirmation(true, undefined, () => []))
		expect(field?.type).toBe('text')
		expect(typeof (field as { validate?: unknown })?.validate).toBe('function')
		const component = (field as { admin?: { components?: { Field?: unknown } } })?.admin?.components
			?.Field as { path?: string; clientProps?: { endpoint?: string } } | undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps?.endpoint).toBe('from-addresses')
	})
})

describe('validateToField', () => {
	const req = { t: (key: string) => key } as unknown as PayloadRequest
	const fields = [
		{ blockType: 'email', name: 'email' },
		{ blockType: 'text', name: 'name' },
	]

	it('passes when unset', () => {
		expect(validateToField(undefined, { data: { fields }, req })).toBe(true)
		expect(validateToField('', { data: { fields }, req })).toBe(true)
	})

	it('passes when the value names an existing email field', () => {
		expect(validateToField('email', { data: { fields }, req })).toBe(true)
	})

	it('fails when the value names a field that is not email-type', () => {
		expect(validateToField('name', { data: { fields }, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
	})

	it('fails when the value names a field that does not exist', () => {
		expect(validateToField('missing', { data: { fields }, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
	})

	it('rejects an email field whose name is empty or whitespace', () => {
		const blankNamed = [
			{ blockType: 'email', name: '' },
			{ blockType: 'email', name: '   ' },
		]
		expect(validateToField('', { data: { fields: blankNamed }, req })).toBe(true)
		expect(validateToField('   ', { data: { fields: blankNamed }, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
	})

	it('does not crash when data.fields is missing or garbled', () => {
		expect(validateToField('email', { data: {}, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
		expect(validateToField('email', { data: { fields: 'not-an-array' }, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
		expect(
			validateToField('email', { data: { fields: [null, 'garbage', { blockType: 'email' }] }, req })
		).toBe('formBuilder:validation.emailFieldUnknown')
		expect(validateToField('email', { data: undefined, req })).toBe(
			'formBuilder:validation.emailFieldUnknown'
		)
	})
})
