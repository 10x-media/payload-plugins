import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Condition, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

type ConditionProps = Parameters<Condition>[2]

const conditionProps = (blockData: ConditionProps['blockData']): ConditionProps => ({
	blockData,
	operation: 'update',
	path: ['fields', 0, 'sourceConfig'],
	user: null,
})

const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) => {
		if (field.type === 'row') {
			return flatten(field.fields)
		}
		if (field.type === 'tabs') {
			return field.tabs.flatMap((tab) => flatten(tab.fields))
		}
		return [field]
	})

const conditionOf = (children: Field[], name: string): Condition => {
	const field = children.find((f) => 'name' in f && f.name === name)
	const admin = field?.admin as { condition?: Condition } | undefined
	if (typeof admin?.condition !== 'function') {
		throw new Error(`expected admin.condition on sourceConfig field: ${name}`)
	}
	return admin.condition
}

describeForDb('form-builder consent capture', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('gates consent sourceConfig fields on blockData.source in the sanitized config', () => {
		const forms = booted.payload.config.collections.find((c) => c.slug === 'forms')
		const blocksField = flatten(forms?.fields ?? []).find(
			(f): f is Extract<Field, { type: 'blocks' }> =>
				f.type === 'blocks' && 'name' in f && f.name === 'fields'
		)
		const consent = blocksField?.blocks.find((b) => b.slug === 'consent')
		const consentFields = flatten(consent?.fields ?? [])

		const source = consentFields.find((f) => 'name' in f && f.name === 'source')
		expect(source).toMatchObject({
			type: 'select',
			defaultValue: 'static',
			admin: { isClearable: false },
		})

		const group = consentFields.find((f) => 'name' in f && f.name === 'sourceConfig')
		const children = group?.type === 'group' ? group.fields : []

		for (const name of ['label', 'url', 'version']) {
			const condition = conditionOf(children, name)
			expect(condition({}, {}, conditionProps({ source: 'static' }))).toBe(true)
			expect(condition({}, {}, conditionProps({ source: 'pageReference' }))).toBe(false)
		}
		for (const name of ['relationTo', 'docId', 'urlField', 'captureVersion']) {
			const condition = conditionOf(children, name)
			expect(condition({}, {}, conditionProps({ source: 'pageReference' }))).toBe(true)
			expect(condition({}, {}, conditionProps({ source: 'static' }))).toBe(false)
		}
	})

	it('stores a consent proof when a required consent field is agreed', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Terms',
				fields: [
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						source: 'static',
						sourceConfig: {
							label: 'Terms of Service',
							url: 'https://example.com/terms',
						},
					},
				],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [{ field: 'terms', value: true }],
			},
		})

		expect(Array.isArray(submission.consent)).toBe(true)
		const proof = (submission.consent as unknown[])[0] as Record<string, unknown>
		expect(proof.field).toBe('terms')
		expect(proof.agreed).toBe(true)
		expect(proof.ref).toBe('https://example.com/terms')
		expect(typeof proof.at).toBe('string')
	})

	it('rejects a submission when a required consent field is not agreed', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Terms',
				fields: [
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						source: 'static',
						sourceConfig: {
							label: 'Terms of Service',
							url: 'https://example.com/terms',
						},
					},
				],
			},
		})

		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: {
					form: form.id,
					values: [{ field: 'terms', value: false }],
				},
			})
		).rejects.toThrow()
	})

	it('rejects when a required consent field is missing from the submission', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Terms',
				fields: [
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						source: 'static',
						sourceConfig: { label: 'Terms', url: 'https://example.com/terms' },
					},
				],
			},
		})

		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [] },
			})
		).rejects.toThrow()
	})

	it('stores agreed:false proof for an optional consent field not agreed', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Marketing',
				fields: [
					{
						blockType: 'consent',
						name: 'marketing',
						label: 'I accept marketing emails',
						optional: true,
						source: 'static',
						sourceConfig: {
							label: 'Marketing policy',
							url: 'https://example.com/marketing',
						},
					},
				],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [{ field: 'marketing', value: false }],
			},
		})

		expect(Array.isArray(submission.consent)).toBe(true)
		const proof = (submission.consent as unknown[])[0] as Record<string, unknown>
		expect(proof.field).toBe('marketing')
		expect(proof.agreed).toBe(false)
		expect(typeof proof.at).toBe('string')
	})

	it('captures proofs for multiple consent fields in a single submission', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Multi-consent',
				fields: [
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						source: 'static',
						sourceConfig: { label: 'Terms', url: 'https://example.com/terms' },
					},
					{
						blockType: 'consent',
						name: 'marketing',
						label: 'I accept marketing emails',
						optional: true,
						source: 'static',
						sourceConfig: { label: 'Marketing', url: 'https://example.com/marketing' },
					},
				],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [
					{ field: 'terms', value: true },
					{ field: 'marketing', value: false },
				],
			},
		})

		expect(Array.isArray(submission.consent)).toBe(true)
		const proofs = submission.consent as unknown[]
		expect(proofs).toHaveLength(2)

		const termsProof = proofs.find(
			(p) => (p as Record<string, unknown>).field === 'terms'
		) as Record<string, unknown>
		expect(termsProof.agreed).toBe(true)
		expect(termsProof.ref).toBe('https://example.com/terms')

		const marketingProof = proofs.find(
			(p) => (p as Record<string, unknown>).field === 'marketing'
		) as Record<string, unknown>
		expect(marketingProof.agreed).toBe(false)
	})

	it('boots a consent block with a rich text statement and still captures proof by reference, never statement text', async () => {
		const statement = {
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{ type: 'text', text: 'I agree to the ' },
							{
								type: 'link',
								fields: { url: 'https://example.com/privacy', newTab: true },
								children: [{ type: 'text', text: 'Privacy Policy' }],
							},
						],
					},
				],
			},
		}

		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Rich statement',
				fields: [
					{
						blockType: 'consent',
						name: 'terms',
						statement,
						source: 'static',
						sourceConfig: { label: 'Terms of Service', url: 'https://example.com/terms' },
					},
				],
			},
		})

		const stored = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const storedField = (stored.fields as Array<Record<string, unknown>>)[0]
		expect(storedField?.statement).toBeTruthy()

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [{ field: 'terms', value: true }],
			},
		})

		expect(Array.isArray(submission.consent)).toBe(true)
		const proof = (submission.consent as unknown[])[0] as Record<string, unknown>
		expect(proof.field).toBe('terms')
		expect(proof.agreed).toBe(true)
		expect(proof.ref).toBe('https://example.com/terms')
		expect(typeof proof.at).toBe('string')
		expect(proof.statement).toBeUndefined()
	})
})
