import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { SerializeBodyArgs } from '../../src/actions/body/serializeBody'
import { buildDefaultActionDefinitions } from '../../src/actions/builtin'
import { resolveActions } from '../../src/actions/registry'
import { runActionsForSubmission } from '../../src/actions/task'
import { formBuilder } from '../../src/index'

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

type Block = { id?: string; blockType: string; [key: string]: unknown }

describeForDb('form-builder email locale', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const serialize = vi.fn(({ body, locale, actionType }: SerializeBodyArgs) => {
		return `<div lang="${locale}" data-action="${actionType}">${String(body)}</div>`
	})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ richText: { serialize } }),
			db,
			configOverrides: { localization },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stamps the request locale on a submission and renders its emails in it', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'email', name: 'email', label: 'Email' }],
				actions: [
					{ blockType: 'emailTeam', to: ['team@example.com'], subject: 'New', body: 'team en' },
					{ blockType: 'confirmation', toField: 'email', subject: 'Thanks', body: 'visitor en' },
				],
			},
			overrideAccess: true,
		})
		const [team, confirmation] = form.actions as Block[]
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: {
				actions: [
					{ ...team, subject: 'Neu', body: 'team de' },
					{ ...confirmation, subject: 'Danke', body: 'visitor de' },
				],
			},
			overrideAccess: true,
		})

		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as unknown as typeof booted.payload.sendEmail

		// A `?locale=de` submit reaches the create hook as `req.locale`, which is what gets stored.
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			locale: 'de',
			data: { form: form.id, values: [{ field: 'email', value: 'visitor@example.com' }] },
		})
		expect(submission.locale).toBe('de')

		sendEmail.mockClear()
		serialize.mockClear()
		await runActionsForSubmission({
			input: { formId: form.id, submissionId: submission.id },
			registry: resolveActions(buildDefaultActionDefinitions({ localize: true })),
			payload: booted.payload,
			// The job runner's request carries another locale; the submission's own must win.
			req: { locale: 'en', payload: booted.payload } as unknown as PayloadRequest,
			richText: { serialize },
		})

		expect(serialize.mock.calls.map(([args]) => [args.locale, args.actionType])).toEqual([
			['de', 'emailTeam'],
			['de', 'confirmation'],
		])
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'team@example.com',
				subject: 'Neu',
				html: '<div lang="de" data-action="emailTeam">team de</div>',
			})
		)
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'visitor@example.com',
				subject: 'Danke',
				html: '<div lang="de" data-action="confirmation">visitor de</div>',
			})
		)
	})

	it('stores the default locale for all, *, or a code the host does not configure', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Plain', fields: [] },
			overrideAccess: true,
		})
		for (const locale of ['all', '*', 'fr']) {
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				locale: locale as 'en',
				data: { form: form.id, values: [] },
			})
			expect(submission.locale).toBe('en')
		}
	})
})

describeForDb('form-builder submission locale without localization', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps a plain language tag and drops anything else to en', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Plain', fields: [] },
			overrideAccess: true,
		})
		// Without localization the local API drops its `locale` arg; a REST `?locale=` still lands on
		// `req.locale` unsanitized, which a pre-set request reproduces.
		const stored = async (locale: string) =>
			(
				await booted.payload.create({
					collection: 'form-submissions',
					req: { locale } as PayloadRequest,
					data: { form: form.id, values: [] },
				})
			).locale
		expect(await stored('uk')).toBe('uk')
		expect(await stored('pt-BR')).toBe('pt-BR')
		expect(await stored('all')).toBe('en')
		expect(await stored('<b>x</b>')).toBe('en')
	})
})
