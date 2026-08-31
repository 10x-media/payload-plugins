import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Field, GlobalConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { buildDefaultActionDefinitions } from '../../src/actions/builtin'
import { resolveActions } from '../../src/actions/registry'
import { runActionsForSubmission } from '../../src/actions/task'
import { type DepartmentOption, resolveDepartmentOptions } from '../../src/email/departments'
import { departmentsField } from '../../src/email/departmentsField'
import { formBuilder } from '../../src/index'

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

const makeSettings = (): GlobalConfig => ({
	slug: 'settings',
	fields: [departmentsField() as Field],
})

// Stand-in for a host resolver reading its own `departmentsField()`-bearing document. Fetched at
// `locale: 'all'` (each localized subfield becomes a `{ en, de }` map), then resolved for the
// requesting locale via the reusable helper (current -> default -> next-available).
const departments = async ({ req }: { req: PayloadRequest }): Promise<DepartmentOption[]> => {
	const settings = await req.payload.findGlobal({
		slug: 'settings',
		depth: 0,
		locale: 'all',
		overrideAccess: true,
	})
	return resolveDepartmentOptions({
		payload: req.payload,
		req,
		doc: settings as Record<string, unknown>,
	})
}

type Row = { id: string }
type Block = { id: string; to?: string[] }

describeForDb('form-builder email.departments routing', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ email: { departments } }),
			db,
			configOverrides: { globals: [makeSettings()], localization },
		})
		// Sales carries both locales; Support is en-only (its de address falls back to en at resolve).
		await booted.payload.updateGlobal({
			slug: 'settings',
			data: {
				departmentEmails: [
					{ label: 'Sales', email: 'sales@example.com' },
					{ label: 'Support', email: 'support@example.com' },
				],
			},
		})
		const seeded = await booted.payload.findGlobal({ slug: 'settings', depth: 0 })
		const rows = (seeded as { departmentEmails?: Row[] }).departmentEmails ?? []
		await booted.payload.updateGlobal({
			slug: 'settings',
			locale: 'de',
			data: {
				departmentEmails: [
					{ id: rows[0]?.id, label: 'Vertrieb', email: 'vertrieb@example.de' },
					{ id: rows[1]?.id, label: 'Support', email: '' },
				],
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const departmentsEndpoint = () => {
		const endpoints = booted.payload.collections.forms?.config.endpoints as
			| Array<{ path: string; handler: (req: PayloadRequest) => Promise<Response> }>
			| undefined
		return endpoints?.find((endpoint) => endpoint.path === '/:id/departments')
	}

	const authedReq = (locale: string) =>
		({
			user: { id: 1, collection: 'users' },
			payload: booted.payload,
			locale,
		}) as unknown as PayloadRequest

	it('registers the departments endpoint on the forms collection', () => {
		expect(departmentsEndpoint()).toBeDefined()
	})

	it('registers the id-less route the selects call, answering like the legacy path', async () => {
		const endpoints = booted.payload.collections.forms?.config.endpoints as
			| Array<{ path: string; handler: (req: PayloadRequest) => Promise<Response> }>
			| undefined
		const idless = endpoints?.find((endpoint) => endpoint.path === '/departments')
		expect(idless).toBeDefined()
		const response = await idless?.handler(authedReq('en'))
		expect(response?.status).toBe(200)
	})

	it('returns 403 for an anonymous request to the endpoint', async () => {
		const response = await departmentsEndpoint()?.handler({
			user: undefined,
			payload: booted.payload,
			locale: 'en',
		} as unknown as PayloadRequest)
		expect(response?.status).toBe(403)
	})

	it('serves options resolved for the requesting admin locale', async () => {
		const en = await departmentsEndpoint()?.handler(authedReq('en'))
		expect(en?.status).toBe(200)
		expect(await en?.json()).toEqual({
			options: [
				{ label: 'Sales', value: 'sales@example.com' },
				{ label: 'Support', value: 'support@example.com' },
			],
		})

		const de = await departmentsEndpoint()?.handler(authedReq('de'))
		expect(await de?.json()).toEqual({
			options: [
				{ label: 'Vertrieb', value: 'vertrieb@example.de' },
				// Support has no de address, so its en one carries through.
				{ label: 'Support', value: 'support@example.com' },
			],
		})
	})

	const makeForm = (to: string) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Routed form',
				fields: [],
				actions: [{ blockType: 'emailTeam', to, subject: 'Hi', body: '' }],
			},
			overrideAccess: true,
		})

	it('accepts an emailTeam "to" that is a known department for the acting locale', async () => {
		const form = await makeForm('sales@example.com')
		const actions = form.actions as Block[]
		expect(actions[0]?.to).toEqual(['sales@example.com'])
	})

	it('accepts an emailTeam "to" outside the departments (free email entry)', async () => {
		const form = await makeForm('anyone@example.com')
		expect((form.actions as Block[])[0]?.to).toEqual(['anyone@example.com'])
	})

	it('rejects an emailTeam "to" that is neither an email nor a field token', async () => {
		await expect(makeForm('not-an-email')).rejects.toThrow()
	})

	it('routes a de-locale submission to the de "to", independent of the run request locale', async () => {
		const form = await makeForm('sales@example.com')
		const blockId = (form.actions as Block[])[0]?.id

		// Store the German address on the same action row, addressed by its own id.
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: {
				actions: [
					{
						id: blockId,
						blockType: 'emailTeam',
						to: 'vertrieb@example.de',
						subject: 'Hi',
						body: '',
					},
				],
			},
			overrideAccess: true,
		})

		// The localized `to` round-trips per locale.
		const en = await booted.payload.findByID({
			collection: 'forms',
			id: form.id,
			locale: 'en',
			depth: 0,
		})
		const de = await booted.payload.findByID({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			depth: 0,
		})
		expect((en.actions as Block[])[0]?.to).toEqual(['sales@example.com'])
		expect((de.actions as Block[])[0]?.to).toEqual(['vertrieb@example.de'])

		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as unknown as typeof booted.payload.sendEmail

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, status: 'complete', values: [] },
			overrideAccess: true,
		})
		// The submission's stored locale is what routing must honor. Set on an update so neither the
		// validate hook (which forces locale on create) nor the action dispatch (create-only) re-fires.
		await booted.payload.update({
			collection: 'form-submissions',
			id: submission.id,
			data: { locale: 'de' },
			overrideAccess: true,
		})
		sendEmail.mockClear()

		const registry = resolveActions(buildDefaultActionDefinitions({ localize: true, departments }))
		await runActionsForSubmission({
			input: { formId: form.id, submissionId: submission.id },
			registry,
			payload: booted.payload,
			// Run request carries the OTHER locale; the submission's de locale must still win.
			req: { locale: 'en', payload: booted.payload } as unknown as PayloadRequest,
		})

		expect(sendEmail).toHaveBeenCalledTimes(1)
		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'vertrieb@example.de' }))
	})
})

describeForDb('form-builder email.departments absent', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers no departments endpoint; the to recipient field offers no preset options', () => {
		const endpoints = booted.payload.collections.forms?.config.endpoints
		expect(
			Array.isArray(endpoints) && endpoints.some((endpoint) => endpoint.path === '/:id/departments')
		).toBe(false)

		const formsCollection = booted.payload.collections.forms
		const tabsField = formsCollection?.config.fields.find((field) => field.type === 'tabs') as
			| { tabs: Array<{ fields: Array<{ name?: string; type?: string }> }> }
			| undefined
		const tabFields = tabsField?.tabs.flatMap((tab) => tab.fields) ?? []
		const actionsField = tabFields.find((field) => field.name === 'actions') as
			| {
					blocks?: Array<{
						slug: string
						fields: Array<{
							type?: string
							name?: string
							fields?: Array<{ name?: string; admin?: unknown }>
						}>
					}>
			  }
			| undefined
		const emailTeamBlock = actionsField?.blocks?.find((b) => b.slug === 'emailTeam')
		const flat = (emailTeamBlock?.fields ?? []).flatMap((f) =>
			f.type === 'row' && f.fields ? f.fields : [f]
		)
		// `to` is always a RecipientsSelect now; absent departments it simply carries no endpoint option.
		const toField = flat.find((f) => f.name === 'to') as
			| { admin?: { components?: unknown } }
			| undefined
		expect(toField).toBeDefined()
		expect(toField?.admin?.components).toBeDefined()
	})
})
