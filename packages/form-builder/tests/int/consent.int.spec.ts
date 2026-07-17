import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Field, GlobalConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { consentSourcesField } from '../../src/consent/consentSourcesField'
import { resolveConsentStatements } from '../../src/consent/resolveConsentStatements'
import type { ConsentSourceEntry, ConsentSourcesResolver } from '../../src/consent/types'
import { formBuilder } from '../../src/index'

const statement = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

/** Drafts on: a published version exists to pin a proof to. */
const pages: CollectionConfig = {
	slug: 'pages',
	versions: { drafts: true },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'slug', type: 'text' },
	],
}

/** Versions on, drafts off: version rows exist but carry no `_status`, so nothing is publishable. */
const notices: CollectionConfig = {
	slug: 'notices',
	versions: true,
	fields: [{ name: 'title', type: 'text' }],
}

/** No versions at all. */
const leaflets: CollectionConfig = {
	slug: 'leaflets',
	fields: [{ name: 'title', type: 'text' }],
}

const settings: GlobalConfig = {
	slug: 'settings',
	fields: [consentSourcesField({ relationTo: ['pages', 'notices', 'leaflets'] }) as Field],
}

type SettingsRow = {
	key?: string | null
	label?: string | null
	statement?: unknown
	page?: { relationTo: string; value: unknown } | null
}

let resolverFails = false

/**
 * A host resolver of the intended shape: read the placed field back, map rows to entries. A
 * multi-tenant host would scope the read by the tenant it derives from `req`; this reads a global,
 * which is enough to prove the seam receives the real per-request `req` and its locale.
 */
const sources: ConsentSourcesResolver = async ({ req }) => {
	if (resolverFails) {
		throw new Error('tenant lookup down')
	}
	const doc = await req.payload.findGlobal({
		slug: 'settings',
		depth: 0,
		locale: req.locale as never,
		req,
	})
	const rows = ((doc as { consentSources?: SettingsRow[] }).consentSources ?? []) as SettingsRow[]
	return rows.flatMap((row): ConsentSourceEntry[] => {
		if (typeof row.key !== 'string' || row.key === '') {
			return []
		}
		const page = row.page
		return [
			{
				key: row.key,
				...(row.label ? { label: row.label } : {}),
				...(row.statement != null ? { statement: row.statement } : {}),
				...(page
					? { page: { relationTo: page.relationTo, id: page.value as number | string } }
					: {}),
				url: `https://example.com/${row.key}`,
			},
		]
	})
}

describeForDb('form-builder consent sources', { dbs: ['mongo'] }, (db) => {
	describe('with consent.sources configured', () => {
		let booted: BootedPayload
		let pageId: number | string
		let noticeId: number | string
		let leafletId: number | string

		beforeAll(async () => {
			resolverFails = false
			booted = await bootPayload({
				plugin: formBuilder({ consent: { sources } }),
				db,
				collections: [pages, notices, leaflets],
				configOverrides: {
					globals: [settings],
					localization: { locales: ['en', 'de'], defaultLocale: 'en' },
				},
			})

			const page = await booted.payload.create({
				collection: 'pages',
				data: { title: 'Privacy Policy', slug: 'privacy', _status: 'published' },
			})
			pageId = page.id
			const notice = await booted.payload.create({
				collection: 'notices',
				data: { title: 'Terms' },
			})
			noticeId = notice.id
			const leaflet = await booted.payload.create({
				collection: 'leaflets',
				data: { title: 'Marketing' },
			})
			leafletId = leaflet.id

			const rows = [
				{
					key: 'privacy',
					label: 'Privacy policy',
					statement: statement('I agree to the privacy policy'),
					page: { relationTo: 'pages', value: pageId },
				},
				{
					key: 'terms',
					label: 'Terms',
					statement: statement('I accept the terms'),
					page: { relationTo: 'notices', value: noticeId },
				},
				{
					key: 'marketing',
					label: 'Marketing',
					statement: statement('Send me email'),
					page: { relationTo: 'leaflets', value: leafletId },
				},
			]
			await booted.payload.updateGlobal({ slug: 'settings', data: { consentSources: rows } })
			// The array itself is not localized, only its statement and label are, so the German pass
			// must address the existing rows by id. Re-sending id-less rows would replace them, taking
			// the English values with them.
			const seeded = await booted.payload.findGlobal({ slug: 'settings', depth: 0 })
			const german = ['Ich stimme der Datenschutzerklärung zu', 'AGB', 'Werbung']
			await booted.payload.updateGlobal({
				slug: 'settings',
				locale: 'de',
				data: {
					consentSources: ((seeded as { consentSources?: SettingsRow[] }).consentSources ?? []).map(
						(row, index) => ({ ...row, statement: statement(german[index] ?? '') })
					),
				},
			})
		})

		afterAll(async () => {
			resolverFails = false
			await booted.stop()
		})

		const flatten = (fields: Field[]): Field[] =>
			fields.flatMap((field) => {
				if (field.type === 'row') return flatten(field.fields)
				if (field.type === 'tabs') return field.tabs.flatMap((tab) => flatten(tab.fields))
				return [field]
			})

		const consentBlockFields = (): Field[] => {
			const forms = booted.payload.collections.forms?.config.fields ?? []
			const blocksField = flatten(forms).find(
				(f): f is Extract<Field, { type: 'blocks' }> =>
					f.type === 'blocks' && 'name' in f && f.name === 'fields'
			)
			return flatten(blocksField?.blocks.find((b) => b.slug === 'consent')?.fields ?? [])
		}

		const makeForm = (source: string, required = true) =>
			booted.payload.create({
				collection: 'forms',
				data: {
					title: `Consent by ${source}`,
					fields: [{ blockType: 'consent', name: 'terms', source, required }],
				},
			})

		const proofOf = (submission: Record<string, unknown>) =>
			(submission.consent as Record<string, unknown>[])[0] as Record<string, unknown>

		const endpoint = () => {
			const endpoints = booted.payload.collections.forms?.config.endpoints as
				| Array<{ path: string; handler: (req: PayloadRequest) => Promise<Response> }>
				| undefined
			return endpoints?.find((e) => e.path === '/:id/consent-sources')
		}

		const callEndpoint = async (over: Record<string, unknown>) =>
			endpoint()?.handler({
				payload: booted.payload,
				context: {},
				routeParams: {},
				...over,
			} as unknown as PayloadRequest)

		it('registers the consent block as a source reference alone', () => {
			const names = consentBlockFields()
				.filter((f) => 'name' in f)
				.map((f) => (f as { name: string }).name)
			expect(names).toContain('source')
			expect(names).toContain('required')
			for (const gone of ['statement', 'sourceConfig', 'optional', 'label', 'placeholder']) {
				expect(names).not.toContain(gone)
			}
		})

		it('refuses an anonymous request to the consent-sources endpoint', async () => {
			const response = await callEndpoint({ user: undefined })
			expect(response?.status).toBe(403)
		})

		it('serves the host sources as options to an authenticated caller', async () => {
			const form = await makeForm('privacy')
			const response = await callEndpoint({
				user: { id: 1, collection: 'users' },
				routeParams: { id: form.id },
			})
			expect(response?.status).toBe(200)
			expect(await response?.json()).toEqual({
				options: [
					{ label: 'Privacy policy', value: 'privacy' },
					{ label: 'Terms', value: 'terms' },
					{ label: 'Marketing', value: 'marketing' },
				],
			})
		})

		it('fails closed with a 503 when the host resolver throws', async () => {
			const form = await makeForm('privacy')
			resolverFails = true
			try {
				const response = await callEndpoint({
					user: { id: 1, collection: 'users' },
					routeParams: { id: form.id },
				})
				expect(response?.status).toBe(503)
			} finally {
				resolverFails = false
			}
		})

		it('stores an id-based proof pinned to the published version when drafts are on', async () => {
			const form = await makeForm('privacy')
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: true }] },
			})
			const proof = proofOf(submission)
			expect(proof.field).toBe('terms')
			expect(proof.agreed).toBe(true)
			expect(proof.source).toBe('privacy')
			expect(proof.page).toEqual({ relationTo: 'pages', id: pageId })
			expect(typeof proof.at).toBe('string')

			const versions = await booted.payload.findVersions({
				collection: 'pages',
				where: { parent: { equals: pageId } },
				depth: 0,
			})
			expect(versions.docs.map((doc) => String(doc.id))).toContain(proof.versionRef)
		})

		it('never stores the statement text, so a policy edit cannot rewrite past proofs', async () => {
			const form = await makeForm('privacy')
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: true }] },
			})
			expect(proofOf(submission).statement).toBeUndefined()
		})

		it('records no versionRef for a versioned page whose collection has drafts off', async () => {
			const form = await makeForm('terms')
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: true }] },
			})
			const proof = proofOf(submission)
			expect(proof.page).toEqual({ relationTo: 'notices', id: noticeId })
			expect(proof.versionRef).toBeUndefined()
		})

		it('records no versionRef for a page whose collection has no versions', async () => {
			const form = await makeForm('marketing')
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: true }] },
			})
			const proof = proofOf(submission)
			expect(proof.page).toEqual({ relationTo: 'leaflets', id: leafletId })
			expect(proof.versionRef).toBeUndefined()
		})

		it('keeps a proof resolvable after the policy page is renamed and re-slugged', async () => {
			const form = await makeForm('privacy')
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: true }] },
			})
			const proof = proofOf(submission)

			await booted.payload.update({
				collection: 'pages',
				id: pageId,
				data: { title: 'Data Protection Notice', slug: 'data-protection', _status: 'published' },
			})

			const page = proof.page as { relationTo: string; id: number | string }
			const resolved = await booted.payload.findByID({
				collection: page.relationTo as 'pages',
				id: page.id,
				depth: 0,
			})
			expect(resolved.title).toBe('Data Protection Notice')
			const stored = await booted.payload.findByID({
				collection: 'form-submissions',
				id: submission.id,
				depth: 0,
			})
			expect((stored.consent as Record<string, unknown>[])[0]).toEqual(proof)
		})

		it('rejects a required consent that is refused, and one that is simply absent', async () => {
			const form = await makeForm('privacy')
			await expect(
				booted.payload.create({
					collection: 'form-submissions',
					data: { form: form.id, values: [{ field: 'terms', value: false }] },
				})
			).rejects.toThrow()
			await expect(
				booted.payload.create({
					collection: 'form-submissions',
					data: { form: form.id, values: [] },
				})
			).rejects.toThrow()
		})

		it('stores an agreed:false proof for a consent field that is not required', async () => {
			const form = await makeForm('marketing', false)
			const submission = await booted.payload.create({
				collection: 'form-submissions',
				depth: 0,
				data: { form: form.id, values: [{ field: 'terms', value: false }] },
			})
			const proof = proofOf(submission)
			expect(proof.agreed).toBe(false)
			expect(proof.source).toBe('marketing')
		})

		it('rejects the submission when the host resolver is down, rather than proving nothing', async () => {
			const form = await makeForm('privacy')
			resolverFails = true
			try {
				await expect(
					booted.payload.create({
						collection: 'form-submissions',
						data: { form: form.id, values: [{ field: 'terms', value: true }] },
					})
				).rejects.toThrow()
			} finally {
				resolverFails = false
			}
		})

		it('resolves the live statement and link for the request locale', async () => {
			const form = await makeForm('privacy')
			const loaded = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })

			const en = await resolveConsentStatements({
				payload: booted.payload,
				req: { payload: booted.payload, context: {}, locale: 'en' } as unknown as PayloadRequest,
				form: loaded as never,
			})
			expect(en.terms?.link).toEqual({
				label: 'Privacy policy',
				url: 'https://example.com/privacy',
			})
			expect(JSON.stringify(en.terms?.statement)).toContain('I agree to the privacy policy')

			const de = await resolveConsentStatements({
				payload: booted.payload,
				req: { payload: booted.payload, context: {}, locale: 'de' } as unknown as PayloadRequest,
				form: loaded as never,
			})
			expect(JSON.stringify(de.terms?.statement)).toContain(
				'Ich stimme der Datenschutzerklärung zu'
			)
		})

		it('reflects an edited statement immediately, with no form to re-save', async () => {
			const form = await makeForm('marketing')
			const loaded = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
			const req = () =>
				({ payload: booted.payload, context: {}, locale: 'en' }) as unknown as PayloadRequest

			const before = await resolveConsentStatements({
				payload: booted.payload,
				req: req(),
				form: loaded as never,
			})
			expect(JSON.stringify(before.terms?.statement)).toContain('Send me email')

			const current = await booted.payload.findGlobal({ slug: 'settings', depth: 0 })
			const rows = (current as { consentSources?: SettingsRow[] }).consentSources ?? []
			await booted.payload.updateGlobal({
				slug: 'settings',
				data: {
					consentSources: rows.map((row) =>
						row.key === 'marketing'
							? { ...row, statement: statement('Send me the newsletter') }
							: row
					),
				},
			})

			const after = await resolveConsentStatements({
				payload: booted.payload,
				req: req(),
				form: loaded as never,
			})
			expect(JSON.stringify(after.terms?.statement)).toContain('Send me the newsletter')
		})

		// Last, and deliberately: this asserts a validation-failed save, so keeping it after every
		// other test means its aborted write can never perturb one that follows.
		it('rejects saving the sources field with two rows sharing a key', async () => {
			await expect(
				booted.payload.updateGlobal({
					slug: 'settings',
					data: {
						consentSources: [
							{ key: 'dupe', statement: statement('One') },
							{ key: 'dupe', statement: statement('Two') },
						],
					},
				})
			).rejects.toThrow()
		})
	})

	describe('with consent.sources absent', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({}), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('registers no consent field type, so an author cannot add one with nothing to reference', () => {
			const forms = booted.payload.collections.forms?.config.fields ?? []
			const tabs = forms.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
			const blocksField = tabs?.tabs
				.flatMap((tab) => tab.fields)
				.find(
					(f): f is Extract<Field, { type: 'blocks' }> =>
						f.type === 'blocks' && 'name' in f && f.name === 'fields'
				)
			expect(blocksField?.blocks.some((b) => b.slug === 'consent')).toBe(false)
		})

		it('registers no consent-sources endpoint', () => {
			const endpoints = booted.payload.collections.forms?.config.endpoints
			expect(
				Array.isArray(endpoints) && endpoints.some((e) => e.path === '/:id/consent-sources')
			).toBe(false)
		})
	})
})
