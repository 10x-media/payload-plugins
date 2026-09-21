import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { SerializeBodyArgs } from '../../src/actions/body/serializeBody'
import { buildDefaultActionDefinitions } from '../../src/actions/builtin'
import type { EmailRenderArgs } from '../../src/actions/emailRender'
import { resolveActions } from '../../src/actions/registry'
import { runActionsForSubmission } from '../../src/actions/task'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { createSubmission, formBuilder } from '../../src/index'

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

type Block = { id?: string; blockType: string; [key: string]: unknown }

// Empty options: Mongo by default, both DBs under the matrix tier (DB_MATRIX), since localized
// writes are where the Postgres adapter differs (`_locales` tables).
describeForDb('form-builder email locale', {}, (db) => {
	let booted: BootedPayload
	const serialize = vi.fn(({ body, locale, actionType }: SerializeBodyArgs) => {
		return `<div lang="${locale}" data-action="${actionType}">${String(body)}</div>`
	})
	// Wraps whatever serialize produced, so the assertions below prove the two compose.
	const render = ({ html, subject }: EmailRenderArgs) => `<main title="${subject}">${html}</main>`

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ richText: { serialize }, email: { render } }),
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
			registry: resolveActions(buildDefaultActionDefinitions({ localize: true, render })),
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
				html: '<main title="Neu"><div lang="de" data-action="emailTeam">team de</div></main>',
			})
		)
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'visitor@example.com',
				subject: 'Danke',
				html: '<main title="Danke"><div lang="de" data-action="confirmation">visitor de</div></main>',
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
	it('takes the locale from createSubmission and leaves the host req as it was', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Server', fields: [] },
			overrideAccess: true,
		})
		const req = { payload: booted.payload, locale: 'en' } as unknown as PayloadRequest
		const submission = await createSubmission(booted.payload, {
			form: form.id,
			values: [],
			locale: 'de',
			req,
		})
		expect(submission.locale).toBe('de')
		expect(req.locale).toBe('en')
		// The explicit locale must not stick to the next create on the same request.
		const next = await createSubmission(booted.payload, { form: form.id, values: [], req })
		expect(next.locale).toBe('en')
	})

	it('serves poll results with option labels in the requested locale', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Poll',
				fields: [
					{
						blockType: 'select',
						name: 'vote',
						label: 'Vote',
						options: [{ label: 'Red', value: 'red' }],
					},
				],
				pollEnabled: true,
				poll: { resultsField: 'vote' },
			},
			overrideAccess: true,
		})
		const [field] = form.fields as Block[]
		const [option] = (field?.options ?? []) as Block[]
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: { fields: [{ ...field, options: [{ ...option, label: 'Rot' }] }] },
			overrideAccess: true,
		})
		await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'vote', value: 'red' }] },
		})

		const results = async (locale: string) => {
			const { status, body } = await resolveFormResultsRequest({
				payload: booted.payload,
				formId: form.id,
				field: 'vote',
				isAuthed: false,
				req: { payload: booted.payload, locale } as unknown as PayloadRequest,
			})
			expect(status).toBe(200)
			return 'results' in body ? body.results[0]?.buckets.map((bucket) => bucket.label) : undefined
		}
		expect(await results('de')).toEqual(['Rot'])
		expect(await results('all')).toEqual(['Red'])
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

	it('keeps a canonical language tag, drops anything else to en, and leaves req.locale unset', async () => {
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
		expect(await stored('zh_Hant')).toBe('zh-Hant')
		expect(await stored('all')).toBe('en')
		expect(await stored('<b>x</b>')).toBe('en')
	})

	it('keeps the createSubmission locale and never writes a locale onto the host req', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Server', fields: [] },
			overrideAccess: true,
		})
		const req = { payload: booted.payload } as unknown as PayloadRequest
		const submission = await createSubmission(booted.payload, {
			form: form.id,
			values: [],
			locale: 'uk',
			req,
		})
		expect(submission.locale).toBe('uk')
		expect(req.locale).toBeUndefined()
	})
})

describeForDb('form-builder email locale without fallback', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({}),
			db,
			configOverrides: { localization: { ...localization, fallback: false } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('falls back to the default locale for email content never authored in the submission locale', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'English only',
				fields: [],
				actions: [
					{ blockType: 'emailTeam', to: ['team@example.com'], subject: 'New', body: 'team en' },
				],
			},
			overrideAccess: true,
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			locale: 'de',
			data: { form: form.id, values: [] },
		})
		expect(submission.locale).toBe('de')

		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as unknown as typeof booted.payload.sendEmail
		const req = {
			locale: 'en',
			fallbackLocale: false,
			payload: booted.payload,
		} as unknown as PayloadRequest
		const results = await runActionsForSubmission({
			input: { formId: form.id, submissionId: submission.id },
			registry: resolveActions(buildDefaultActionDefinitions({ localize: true })),
			payload: booted.payload,
			req,
		})

		expect(results).toEqual([{ type: 'emailTeam', ok: true }])
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'team@example.com', subject: 'New' })
		)
		// The job runner's request comes back as it was handed in.
		expect(req.locale).toBe('en')
		expect(req.fallbackLocale).toBe(false)
	})
})

describeForDb('form-builder per-form fallback locale', {}, (db) => {
	let booted: BootedPayload
	const fallbackLocale = vi.fn(({ form }: { form: { title?: string } }) =>
		form.title === 'Tenant uk' ? 'uk' : undefined
	)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ fallbackLocale }),
			db,
			configOverrides: { localization: { locales: ['en', 'de', 'uk'], defaultLocale: 'en' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	/** A form whose email content exists only in `uk`, the owner's own default. */
	const ukOnlyForm = async (title: string) => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title,
				fields: [],
				actions: [{ blockType: 'emailTeam', to: ['team@example.com'], subject: '', body: '' }],
			},
			overrideAccess: true,
		})
		const [team] = form.actions as Block[]
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'uk',
			data: { actions: [{ ...team, subject: 'Нова заявка', body: 'uk body' }] },
			overrideAccess: true,
		})
		return form
	}

	const runFor = async (formId: number | string) => {
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			locale: 'de',
			data: { form: formId, values: [] },
		})
		return runActionsForSubmission({
			input: { formId, submissionId: submission.id },
			registry: resolveActions(buildDefaultActionDefinitions({ localize: true })),
			payload: booted.payload,
		})
	}

	it('falls back to the locale the resolver picks for the form', async () => {
		const form = await ukOnlyForm('Tenant uk')
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as unknown as typeof booted.payload.sendEmail
		fallbackLocale.mockClear()

		expect(await runFor(form.id)).toEqual([{ type: 'emailTeam', ok: true }])
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'team@example.com', subject: 'Нова заявка' })
		)
		expect(fallbackLocale).toHaveBeenCalledWith(
			expect.objectContaining({ locale: 'de', form: expect.objectContaining({ id: form.id }) })
		)
	})

	it('keeps the default fallback, and fails rather than sending an empty email, when it picks none', async () => {
		const form = await ukOnlyForm('Other tenant')
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as unknown as typeof booted.payload.sendEmail

		expect(await runFor(form.id)).toEqual([
			expect.objectContaining({
				type: 'emailTeam',
				ok: false,
				error: 'emailTeam: empty subject and body',
			}),
		])
		expect(sendEmail).not.toHaveBeenCalled()
	})
})
