import type { CollectionSlug, Payload } from 'payload'
import type { Form, Setting } from '../payload-types'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/** A field row from a form's `fields` blocks array, loosely typed for seed-time reshaping. */
type FormFieldRow = {
	id?: string | number | null
	name?: string | null
	label?: string | null
	[key: string]: unknown
}

/**
 * Create a form by title if it does not exist yet, always returning the form (found or created) so
 * callers can chain locale- or submission-seeding steps that only make sense on first creation.
 */
const ensureForm = async (
	payload: Payload,
	title: string,
	data: Record<string, unknown>
): Promise<{ doc: Form; created: boolean }> => {
	const existing = await payload.find({
		collection: 'forms',
		where: { title: { equals: title } },
		limit: 1,
		depth: 0,
	})
	const found = existing.docs[0]
	if (found) {
		return { doc: found, created: false }
	}
	const created = await payload.create({ collection: 'forms', data: { title, ...data } })
	payload.logger.info(`Seeded form: ${title}`)
	return { doc: created, created: true }
}

const ensurePage = async (
	payload: Payload,
	collection: CollectionSlug,
	data: Record<string, unknown>
): Promise<number | string> => {
	const existing = await payload.find({
		collection,
		where: { slug: { equals: data.slug } },
		limit: 1,
		depth: 0,
	})
	const found = existing.docs[0]
	if (found) {
		return found.id
	}
	const created = await payload.create({ collection, data })
	payload.logger.info(`Seeded ${collection}: ${String(data.slug)}`)
	return created.id
}

const statement = (text: string) => ({
	root: {
		type: 'root',
		format: '' as const,
		indent: 0,
		version: 1,
		direction: 'ltr' as const,
		children: [
			{
				type: 'paragraph',
				format: '' as const,
				indent: 0,
				version: 1,
				direction: 'ltr' as const,
				children: [
					{ type: 'text', text, format: 0, style: '', detail: 0, mode: 'normal', version: 1 },
				],
			},
		],
	},
})

type ConsentSourceIds = { privacy: string; marketing: string }

type SeededConsentRow = {
	id?: string | number | null
	name?: string | null
	statement?: unknown
	page?: { relationTo: string; value: unknown } | null
}

const idByName = (rows: SeededConsentRow[], name: string): string =>
	String(rows.find((r) => r.name === name)?.id)

/**
 * The consent statements this app's forms reference, on the `settings` global where the plugin's
 * `consent.sources` resolver reads them. `privacy` points at a drafts-enabled page, so its proofs
 * pin a published version; `marketing` points at a version-less notice, so its proofs carry a page
 * and no version. Idempotent (skips creation once any row exists), and always returns each row's
 * auto-assigned id so the demo forms below can reference them as a consent field's `source`.
 *
 * Privacy also gets a German translation (name + statement), added on a follow-up `locale: 'de'`
 * write addressed by the row's own id; marketing stays English-only and reads through the German
 * locale via `localization.fallback`. The whole array is resent on every write (Payload replaces a
 * blocks/array field's row set wholesale; it is not itself locale-aware), so marketing's English
 * content is simply repeated into the `de` write rather than translated.
 */
const seedConsentSources = async (payload: Payload): Promise<ConsentSourceIds> => {
	const current = await payload.findGlobal({ slug: 'settings', depth: 0 })
	const existingRows = (current.consentSources ?? []) as unknown as SeededConsentRow[]
	if (existingRows.length > 0) {
		return {
			privacy: idByName(existingRows, 'Privacy policy'),
			marketing: idByName(existingRows, 'Marketing emails'),
		}
	}
	const privacyId = await ensurePage(payload, 'legal-pages', {
		title: 'Privacy Policy',
		slug: 'privacy',
		_status: 'published',
	})
	const marketingId = await ensurePage(payload, 'notices', {
		title: 'Marketing Preferences',
		slug: 'marketing',
	})
	const marketingStatementEn = statement('Send me occasional product news')
	const updated = await payload.updateGlobal({
		slug: 'settings',
		data: {
			consentSources: [
				{
					name: 'Privacy policy',
					statement: statement('I have read and agree to the privacy policy'),
					page: { relationTo: 'legal-pages', value: privacyId as string },
				},
				{
					name: 'Marketing emails',
					statement: marketingStatementEn,
					page: { relationTo: 'notices', value: marketingId as string },
				},
			] as unknown as Setting['consentSources'],
		},
	})
	payload.logger.info('Seeded consent sources: privacy, marketing')
	const savedRows = (updated.consentSources ?? []) as unknown as SeededConsentRow[]
	const privacyRowId = idByName(savedRows, 'Privacy policy')
	const marketingRowId = idByName(savedRows, 'Marketing emails')

	await payload.updateGlobal({
		slug: 'settings',
		locale: 'de',
		data: {
			consentSources: [
				{
					id: privacyRowId,
					name: 'Datenschutzerklärung',
					statement: statement('Ich habe die Datenschutzerklärung gelesen und stimme zu'),
					page: { relationTo: 'legal-pages', value: privacyId as string },
				},
				{
					id: marketingRowId,
					name: 'Marketing emails',
					statement: marketingStatementEn,
					page: { relationTo: 'notices', value: marketingId as string },
				},
			] as unknown as Setting['consentSources'],
		},
	})
	payload.logger.info('Localized consent source (de): Privacy policy')

	return { privacy: privacyRowId, marketing: marketingRowId }
}

type SeededDepartmentRow = {
	id?: string | number | null
	label?: string | null
	email?: string | null
}

const idByLabel = (rows: SeededDepartmentRow[], label: string): string =>
	String(rows.find((r) => r.label === label)?.id)

/**
 * Department routing addresses for the `emailTeam` action's `to` (plugin option `email.departments`,
 * wired in `payload.config.ts` via `resolveDepartmentOptions`). Seeds the four locale combinations the
 * feature supports: Support carries a distinct address per locale; Sales and Billing are only ever
 * given an English address (their German cell is explicitly emptied on the `de` write rather than
 * omitted, so the row is never dropped, and the resolver's own fallback surfaces the English address
 * to a German admin); Presse is only ever given a German address, created directly on the `de` write
 * so it never has an English one. Idempotent (skips once any row exists).
 */
const seedDepartments = async (payload: Payload): Promise<void> => {
	const current = await payload.findGlobal({ slug: 'settings', depth: 0 })
	const existingRows = (current.departmentEmails ?? []) as unknown as SeededDepartmentRow[]
	if (existingRows.length > 0) {
		return
	}
	const updated = await payload.updateGlobal({
		slug: 'settings',
		data: {
			departmentEmails: [
				{ label: 'Support', email: 'support@example.com' },
				{ label: 'Sales', email: 'sales@example.com' },
				{ label: 'Billing', email: 'billing@example.com' },
			],
		},
	})
	payload.logger.info('Seeded departments: Support, Sales, Billing')
	const savedRows = (updated.departmentEmails ?? []) as unknown as SeededDepartmentRow[]
	const supportId = idByLabel(savedRows, 'Support')
	const salesId = idByLabel(savedRows, 'Sales')
	const billingId = idByLabel(savedRows, 'Billing')

	await payload.updateGlobal({
		slug: 'settings',
		locale: 'de',
		data: {
			departmentEmails: [
				// Both locales carry their own address.
				{ id: supportId, label: 'Kundensupport', email: 'support-de@example.com' },
				// English-only: the empty de address falls back to the en one at resolve time.
				{ id: salesId, label: 'Sales', email: '' },
				// Same address everywhere by intent (finance wants one inbox, never a per-market one);
				// seeded once in en, so the de cell stays empty and falls back rather than repeating it.
				{ id: billingId, label: 'Billing', email: '' },
				// German-only: created directly on this write, so it never gets an en address.
				{ label: 'Presse', email: 'presse@example.de' },
			],
		},
	})
	payload.logger.info('Localized departments (de): Kundensupport, Presse')
}

const ATHLETES: { name: string; discipline: string; country: string }[] = [
	{ name: 'Mara Vieira', discipline: 'Sprint', country: 'Brazil' },
	{ name: 'Jonas Keller', discipline: 'Marathon', country: 'Germany' },
	{ name: 'Aiko Tanaka', discipline: 'Sprint', country: 'Japan' },
	{ name: 'Liam Byrne', discipline: 'Middle distance', country: 'Ireland' },
	{ name: 'Nadia Haddad', discipline: 'Hurdles', country: 'Morocco' },
	{ name: 'Sven Larsson', discipline: 'Long jump', country: 'Sweden' },
	{ name: 'Priya Nair', discipline: 'Sprint', country: 'India' },
	{ name: 'Diego Morales', discipline: 'Marathon', country: 'Mexico' },
	{ name: 'Zoe Bennett', discipline: 'Hurdles', country: 'Australia' },
	{ name: 'Kofi Mensah', discipline: 'Sprint', country: 'Ghana' },
]

// The first four athletes are the ones this form makes voteable; the rest exist but never appear as
// choices, which is the whole point of the demo.
const VOTEABLE_NAMES = ATHLETES.slice(0, 4).map((athlete) => athlete.name)

/** Seed the ten athletes the `athleteVote` field draws from. Idempotent (skips once any exist). */
const seedAthletes = async (payload: Payload): Promise<void> => {
	const existing = await payload.count({ collection: 'athletes' })
	if (existing.totalDocs > 0) {
		return
	}
	for (const data of ATHLETES) {
		await payload.create({ collection: 'athletes', data })
	}
	payload.logger.info(`Seeded ${ATHLETES.length} athletes`)
}

/**
 * Localize `Demo Contact`'s `fullName` field label to German, addressing the row by its own
 * auto-assigned id. Every other row is resent verbatim alongside it (a blocks array is replaced
 * wholesale on write, so an omitted row would be dropped, not preserved), which duplicates their
 * English content into the `de` write rather than translating it -- harmless, and the same pattern
 * the plugin's own `tests/int/localization.int.spec.ts` uses to localize a single block field.
 */
const localizeDemoContact = async (payload: Payload, form: Form): Promise<void> => {
	const rows = (form.fields ?? []) as unknown as FormFieldRow[]
	const localized = rows.map((row) =>
		row.name === 'fullName' ? { ...row, label: 'Vollständiger Name' } : row
	)
	await payload.update({
		collection: 'forms',
		id: form.id,
		locale: 'de',
		data: { title: 'Demo Kontakt', fields: localized as unknown as Form['fields'] },
	})
	payload.logger.info('Localized form title + field label (de): Demo Contact > fullName')
}

/**
 * An en and a de submission to `Demo Contact`, so the submission admin's `SubmissionAnswers` view has
 * one of each locale to render (each submission's descriptors are captured from the form as read in
 * its own creation locale, per `validateSubmission`). Both agree to the required `terms` consent, so
 * they also double as the demo's consent-proof example; a separate consent-only row would be
 * redundant since every `Demo Contact` submission carries one.
 */
const seedDemoContactSubmissions = async (payload: Payload, formId: string): Promise<void> => {
	await payload.create({
		collection: 'form-submissions',
		locale: 'en',
		data: {
			form: formId,
			values: [
				{ field: 'fullName', value: 'Ada Lovelace' },
				{ field: 'email', value: 'ada@example.com' },
				{ field: 'role', value: 'dev' },
				{ field: 'terms', value: true },
				{ field: 'news', value: true },
			],
		},
	})
	await payload.create({
		collection: 'form-submissions',
		locale: 'de',
		data: {
			form: formId,
			values: [
				{ field: 'fullName', value: 'Max Mustermann' },
				{ field: 'email', value: 'max@example.de' },
				{ field: 'role', value: 'other' },
				{ field: 'otherRole', value: 'Designer' },
				{ field: 'terms', value: true },
				{ field: 'news', value: false },
			],
		},
	})
	payload.logger.info('Seeded submissions: Demo Contact (en, de)')
}

/**
 * Votes for the athlete poll, then closes it retroactively (`closesAt` set to a past, literal ISO
 * date so the seed stays deterministic across boots). `mostVoted` then has real data to resolve from,
 * and since this dev app registers no jobs plugin, the results endpoint's no-runner fallback
 * (`resolveFormResultsRequest` -> `shouldAutoResolvePoll` -> `resolvePollOutcome`) resolves the winner
 * the next time anyone reads results, rather than a scheduled job.
 *
 * Votes are cast before the closing update (the poll is still open when they are submitted), because
 * once `closesAt` is in the past, `validateSubmission` rejects every further submission to this form.
 */
const seedAthletePollVotes = async (
	payload: Payload,
	formId: string,
	athleteIdByName: Map<string, string | number>
): Promise<void> => {
	const mara = athleteIdByName.get('Mara Vieira')
	const jonas = athleteIdByName.get('Jonas Keller')
	if (mara != null) {
		await payload.create({
			collection: 'form-submissions',
			locale: 'en',
			data: { form: formId, values: [{ field: 'pick', value: mara }] },
		})
		await payload.create({
			collection: 'form-submissions',
			locale: 'de',
			data: { form: formId, values: [{ field: 'pick', value: mara }] },
		})
	}
	if (jonas != null) {
		await payload.create({
			collection: 'form-submissions',
			locale: 'en',
			data: { form: formId, values: [{ field: 'pick', value: jonas }] },
		})
	}
	payload.logger.info('Seeded votes: Who will win? (Mara Vieira x2, Jonas Keller x1)')

	await payload.update({
		collection: 'forms',
		id: formId,
		data: { poll: { closesAt: '2026-07-15T18:00:00.000Z' } },
	})
	payload.logger.info('Closed poll: Who will win? (closesAt in the past; type stays mostVoted)')
}

/**
 * Seed the dev Payload app: an admin user, the consent sources and department addresses and the
 * policy pages they reference, an `athletes` collection, plus demo forms the `(frontend)` pages
 * render and the e2e suite drives -- a multi-step contact form (a conditional field, a required
 * consent, required-field validation, localized in German), a single-choice poll with public
 * results, and a relationship-backed poll whose `athleteVote` field makes four of the seeded athletes
 * voteable (its `resolveOptions` sources the choices, the winner select, and the results labels from
 * those records) and which this seed also votes on and closes, demonstrating `mostVoted` auto-resolve.
 * Idempotent (keyed on title, or on the presence of rows/docs for the global fields and submissions).
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const consentSourceIds = await seedConsentSources(payload)
	await seedDepartments(payload)
	await seedAthletes(payload)

	const demoContact = await ensureForm(payload, 'Demo Contact', {
		multistep: true,
		fields: [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
			{
				blockType: 'select',
				name: 'role',
				label: 'Role',
				options: [
					{ label: 'Developer', value: 'dev' },
					{ label: 'Other', value: 'other' },
				],
			},
			{
				blockType: 'text',
				name: 'otherRole',
				label: 'Please specify',
				visibleWhen: { or: [{ and: [{ role: { equals: 'other' } }] }] },
			},
			{ blockType: 'consent', name: 'terms', source: consentSourceIds.privacy, required: true },
			{ blockType: 'consent', name: 'news', source: consentSourceIds.marketing },
		],
		flow: {
			steps: [
				{ id: 'step1', fields: ['fullName', 'email'], next: 'step2' },
				{ id: 'step2', fields: ['role', 'otherRole', 'terms', 'news'] },
			],
		},
	})
	if (demoContact.created) {
		await localizeDemoContact(payload, demoContact.doc)
		await seedDemoContactSubmissions(payload, String(demoContact.doc.id))
	}

	await ensureForm(payload, 'Favorite framework', {
		fields: [
			{
				blockType: 'select',
				name: 'framework',
				label: 'Favorite framework',
				required: true,
				options: [
					{ label: 'Payload', value: 'payload' },
					{ label: 'Strapi', value: 'strapi' },
					{ label: 'Sanity', value: 'sanity' },
				],
			},
		],
		pollEnabled: true,
		poll: { resultsField: 'framework' },
	})

	const voteable = await payload.find({
		collection: 'athletes',
		where: { name: { in: VOTEABLE_NAMES } },
		depth: 0,
		limit: VOTEABLE_NAMES.length,
	})
	const voteableIds = voteable.docs.map((athlete) => athlete.id)
	const whoWillWin = await ensureForm(payload, 'Who will win?', {
		fields: [
			{
				blockType: 'athleteVote',
				name: 'pick',
				label: 'Cast your vote',
				required: true,
				athletes: voteableIds,
			},
		],
		pollEnabled: true,
		poll: { resultsField: 'pick', type: 'mostVoted' },
	})
	if (whoWillWin.created) {
		const athleteIdByName = new Map(
			voteable.docs.map((athlete) => [athlete.name, athlete.id] as const)
		)
		await seedAthletePollVotes(payload, String(whoWillWin.doc.id), athleteIdByName)
	}
}
