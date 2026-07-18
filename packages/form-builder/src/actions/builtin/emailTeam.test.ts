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

	const bodyFieldOf = (definition: ReturnType<typeof buildEmailTeam>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'body') as
			| { editor?: unknown }
			| undefined

	it('omits editor from the body field by default', () => {
		expect(bodyFieldOf(buildEmailTeam(true))?.editor).toBeUndefined()
	})

	it('spreads a custom editor onto the body field when given', () => {
		const editor = { fake: 'editor' } as never
		expect(bodyFieldOf(buildEmailTeam(true, editor))?.editor).toBe(editor)
	})

	const fromFieldOf = (definition: ReturnType<typeof buildEmailTeam>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'from')

	it('omits the from field when no fromAddresses resolver is given', () => {
		expect(fromFieldOf(buildEmailTeam(true))).toBeUndefined()
	})

	it('adds a from field backed by the from-addresses endpoint when a resolver is given', () => {
		const field = fromFieldOf(buildEmailTeam(true, undefined, () => []))
		expect(field?.type).toBe('text')
		expect(typeof (field as { validate?: unknown })?.validate).toBe('function')
		const component = (field as { admin?: { components?: { Field?: unknown } } })?.admin?.components
			?.Field as { path?: string; clientProps?: { endpoint?: string } } | undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps?.endpoint).toBe('from-addresses')
	})

	const toFieldOf = (definition: ReturnType<typeof buildEmailTeam>) =>
		definition.config?.find((field) => 'name' in field && field.name === 'to')

	it('keeps to a plain, localized text field when no departments resolver is given', () => {
		const field = toFieldOf(buildEmailTeam(true))
		expect(field?.type).toBe('text')
		expect((field as { localized?: boolean })?.localized).toBe(true)
		expect((field as { admin?: { components?: unknown } })?.admin?.components).toBeUndefined()
	})

	it('drops the localized flag on to when localize is false', () => {
		const field = toFieldOf(buildEmailTeam(false))
		expect((field as { localized?: boolean })?.localized).toBeUndefined()
	})

	it('turns to into a departments select when a resolver is given', () => {
		const field = toFieldOf(buildEmailTeam(true, undefined, undefined, () => []))
		expect(field?.type).toBe('text')
		expect((field as { localized?: boolean })?.localized).toBe(true)
		expect(typeof (field as { validate?: unknown })?.validate).toBe('function')
		const component = (field as { admin?: { components?: { Field?: unknown } } })?.admin?.components
			?.Field as { path?: string; clientProps?: { endpoint?: string } } | undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps?.endpoint).toBe('departments')
	})
})
