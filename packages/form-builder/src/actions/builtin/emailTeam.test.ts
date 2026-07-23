import { describe, expect, it, vi } from 'vitest'
import type { SubmissionValue } from '../../submissions/types'
import { makeRenderBody } from '../body/serializeBody'
import type { ActionRunArgs } from '../defineAction'
import { buildEmailTeam, emailTeam } from './emailTeam'

const form = { id: 'form-1', title: 'Test Form' }
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

describe('emailTeam', () => {
	it('calls sendEmail with interpolated subject and legacy string body', async () => {
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

	it('serializes a lexical body to interpolated HTML', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		const body = {
			root: {
				type: 'root',
				children: [
					{ type: 'paragraph', children: [{ type: 'text', text: 'From {{name}}', format: 1 }] },
				],
			},
		}

		await emailTeam.run(
			baseArgs({
				config: { to: 'team@example.com', subject: 'Alert', body },
				values: [{ field: 'name', value: 'A & B' }],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com',
			subject: 'Alert',
			html: '<p><strong>From A &amp; B</strong></p>',
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

	it('omits from from sendEmail when config.from is unset', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: { to: 'team@example.com', subject: 'Hi', body: 'body' },
				values: [],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({ to: 'team@example.com', subject: 'Hi', html: 'body' })
	})

	it('includes from in sendEmail when config.from is set', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: {
					to: 'team@example.com',
					from: 'Support <support@example.com>',
					subject: 'Hi',
					body: 'body',
				},
				values: [],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com',
			subject: 'Hi',
			html: 'body',
			from: 'Support <support@example.com>',
		})
	})

	it('omits cc, bcc, and replyTo from sendEmail when unset', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: { to: 'team@example.com', subject: 'Hi', body: 'body' },
				values: [],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({ to: 'team@example.com', subject: 'Hi', html: 'body' })
	})

	it('includes cc, bcc, and replyTo in sendEmail when configured', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: {
					to: 'team@example.com',
					cc: 'cc@example.com',
					bcc: 'bcc@example.com',
					replyTo: 'reply@example.com',
					subject: 'Hi',
					body: 'body',
				},
				values: [],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com',
			subject: 'Hi',
			html: 'body',
			cc: 'cc@example.com',
			bcc: 'bcc@example.com',
			replyTo: 'reply@example.com',
		})
	})

	it('interpolates merge tags in cc, bcc, and replyTo', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: {
					to: 'team@example.com',
					cc: '{{ccAddress}}',
					bcc: '{{bccAddress}}',
					replyTo: '{{replyAddress}}',
					subject: 'Hi',
					body: 'body',
				},
				values: [
					{ field: 'ccAddress', value: 'cc@example.com' },
					{ field: 'bccAddress', value: 'bcc@example.com' },
					{ field: 'replyAddress', value: 'reply@example.com' },
				],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com',
			subject: 'Hi',
			html: 'body',
			cc: 'cc@example.com',
			bcc: 'bcc@example.com',
			replyTo: 'reply@example.com',
		})
	})

	it('routes a multi-recipient to list, resolving a token and dropping empties', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		const payload = { sendEmail } as unknown as Parameters<typeof emailTeam.run>[0]['payload']

		await emailTeam.run(
			baseArgs({
				config: {
					to: ['team@example.com', '{{email}}', '{{missing}}'],
					subject: 'Hi',
					body: 'body',
				},
				values: [{ field: 'email', value: 'user@example.com' }],
				payload,
			})
		)

		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@example.com, user@example.com',
			subject: 'Hi',
			html: 'body',
		})
	})

	const bodyFieldOf = (definition: ReturnType<typeof buildEmailTeam>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'body') as
			| { editor?: unknown }
			| undefined

	it('omits editor from the body field by default', () => {
		expect(bodyFieldOf(buildEmailTeam({ localize: true }))?.editor).toBeUndefined()
	})

	it('spreads a custom editor onto the body field when given', () => {
		const editor = { fake: 'editor' } as never
		expect(bodyFieldOf(buildEmailTeam({ localize: true, editor }))?.editor).toBe(editor)
	})

	const fromFieldOf = (definition: ReturnType<typeof buildEmailTeam>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'from')

	it('omits the from field when no fromAddresses resolver is given', () => {
		expect(fromFieldOf(buildEmailTeam({ localize: true }))).toBeUndefined()
	})

	it('adds a from field backed by the from-addresses endpoint when a resolver is given', () => {
		const field = fromFieldOf(buildEmailTeam({ localize: true, fromAddresses: () => [] }))
		expect(field?.type).toBe('text')
		expect(typeof (field as { validate?: unknown })?.validate).toBe('function')
		const component = (field as { admin?: { components?: { Field?: unknown } } })?.admin?.components
			?.Field as { path?: string; clientProps?: { endpoint?: string } } | undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps?.endpoint).toBe('from-addresses')
	})

	// Recipient fields live inside presentational rows; flatten to read them by name.
	const flatFields = (definition: ReturnType<typeof buildEmailTeam>) =>
		(definition.config ?? []).flatMap((field) => (field.type === 'row' ? field.fields : [field]))
	const fieldNamed = (definition: ReturnType<typeof buildEmailTeam>, name: string) =>
		flatFields(definition).find((field) => 'name' in field && field.name === name)

	const RECIPIENTS_REF = '@10x-media/form-builder/client#RecipientsSelect'
	type RecipField = {
		type?: string
		hasMany?: boolean
		localized?: boolean
		validate?: unknown
		admin?: {
			width?: string
			components?: { Field?: { path?: string; clientProps?: { endpoint?: string } } }
		}
	}

	it('makes to, replyTo, cc, and bcc recipient fields (text hasMany, RecipientsSelect, 50% width)', () => {
		for (const name of ['to', 'replyTo', 'cc', 'bcc']) {
			const field = fieldNamed(buildEmailTeam({ localize: true }), name) as RecipField | undefined
			expect(field?.type).toBe('text')
			expect(field?.hasMany).toBe(true)
			expect(field?.localized).toBe(true)
			expect(field?.admin?.width).toBe('50%')
			expect(field?.admin?.components?.Field?.path).toBe(RECIPIENTS_REF)
			expect(typeof field?.validate).toBe('function')
		}
	})

	it('drops the localized flag on the recipient fields when localize is false', () => {
		for (const name of ['to', 'replyTo', 'cc', 'bcc']) {
			const field = fieldNamed(buildEmailTeam({ localize: false }), name) as RecipField | undefined
			expect(field?.localized).toBeUndefined()
		}
	})

	it('pairs to+replyTo and cc+bcc on rows', () => {
		const rows = (buildEmailTeam({ localize: true }).config ?? []).filter(
			(field): field is Extract<typeof field, { type: 'row' }> => field.type === 'row'
		)
		const rowNames = rows.map((row) => row.fields.map((f) => ('name' in f ? f.name : undefined)))
		expect(rowNames).toContainEqual(['to', 'replyTo'])
		expect(rowNames).toContainEqual(['cc', 'bcc'])
	})

	it('gives the recipient fields the departments endpoint only when a resolver is given', () => {
		const withDepts = fieldNamed(buildEmailTeam({ localize: true, departments: () => [] }), 'to') as
			| RecipField
			| undefined
		expect(withDepts?.admin?.components?.Field?.clientProps?.endpoint).toBe('departments')
		const without = fieldNamed(buildEmailTeam({ localize: true }), 'to') as RecipField | undefined
		expect(without?.admin?.components?.Field?.clientProps?.endpoint).toBeUndefined()
	})
})
