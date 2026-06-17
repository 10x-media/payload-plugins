import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder consent capture', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
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
})
