import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry } from '../validation/registry'
import { runSubmission } from './runSubmission'
import type { FormFieldInstance } from './types'

const registry = buildRegistry(defaultFieldDefinitions)
const ruleRegistry = buildRuleRegistry(defaultValidationRules)
const consentRegistry = new Map()
const t = (key: string) => key
const base = {
	registry,
	ruleRegistry,
	consentRegistry,
	locale: 'en',
	t,
	operation: 'create' as const,
}

describe('runSubmission', () => {
	it('validates required and email, snapshots descriptors, returns typed values', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'fullName', value: 'Ada' },
				{ field: 'email', value: 'ada@x.com' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.descriptors).toEqual([
			{ field: 'fullName', label: 'Full name', fieldType: 'text' },
			{ field: 'email', label: 'Email', fieldType: 'email' },
		])
		expect(result.values).toEqual([
			{ field: 'fullName', value: 'Ada' },
			{ field: 'email', value: 'ada@x.com' },
		])
	})

	it('reports a per-field error for a missing required field', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
		]
		const result = await runSubmission({ ...base, fields, values: [] })
		expect(result.errors).toEqual([
			{ path: 'fullName', message: 'formBuilder:validation.required' },
		])
	})

	it('reports a format error for a bad email', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'email', value: 'nope' }],
		})
		expect(result.errors).toEqual([{ path: 'email', message: 'formBuilder:validation.email' }])
	})

	it('coerces number values and snapshots select option labels', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'age', label: 'Age' },
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				options: [
					{ label: 'Free', value: 'free' },
					{ label: 'Pro', value: 'pro' },
				],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'age', value: '42' },
				{ field: 'plan', value: 'pro' },
			],
		})
		expect(result.values).toEqual([
			{ field: 'age', value: 42 },
			{ field: 'plan', value: 'pro' },
		])
		const planDescriptor = result.descriptors.find((descriptor) => descriptor.field === 'plan')
		expect(planDescriptor?.optionLabels).toEqual({ free: 'Free', pro: 'Pro' })
	})

	it('rejects a select value outside its options', async () => {
		const fields: FormFieldInstance[] = [
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				required: true,
				options: [{ label: 'Free', value: 'free' }],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'plan', value: 'enterprise' }],
		})
		expect(result.errors).toEqual([{ path: 'plan', message: 'formBuilder:validation.select' }])
	})

	it('skips optional empty fields (no value, no descriptor)', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'nickname', label: 'Nickname' }]
		const result = await runSubmission({ ...base, fields, values: [] })
		expect(result.values).toEqual([])
		expect(result.descriptors).toEqual([])
	})

	it('ignores values for unknown field types', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'mystery', name: 'x', label: 'X' }]
		const result = await runSubmission({ ...base, fields, values: [{ field: 'x', value: 'y' }] })
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([])
		expect(result.descriptors).toEqual([])
	})

	it('rejects a non-numeric value for a number field', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'number', name: 'age', label: 'Age' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'age', value: 'abc' }],
		})
		expect(result.errors).toEqual([{ path: 'age', message: 'formBuilder:validation.number' }])
		expect(result.values).toEqual([])
	})

	it('coerces a checkbox string "false" to the boolean false, never a truthy string', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'checkbox', name: 'agree', label: 'Agree' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'agree', value: 'false' }],
		})
		expect(result.values).toEqual([{ field: 'agree', value: false }])
	})

	it('rejects a required consent submitted as the string "false"', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'consent', name: 'terms', label: 'I agree' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'terms', value: 'false' }],
		})
		expect(result.errors).toHaveLength(1)
		expect(result.errors[0]?.path).toBe('terms')
	})

	// `false` is a present value, so the engine's required guard never fires on it; the checkbox's
	// intrinsic validator is what stops a client posting an explicit refusal to a required box.
	it('rejects a required checkbox submitted as false', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'checkbox', name: 'terms', label: 'I agree', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'terms', value: false }],
		})
		expect(result.errors).toEqual([{ path: 'terms', message: 'formBuilder:validation.required' }])
	})

	it('accepts a required checkbox submitted as true', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'checkbox', name: 'terms', label: 'I agree', required: true },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'terms', value: true }],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'terms', value: true }])
	})

	it('stores an optional checkbox left unchecked', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'checkbox', name: 'news', label: 'Newsletter' },
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'news', value: false }],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'news', value: false }])
	})

	it('enforces a declarative minLength rule with the coerced value', async () => {
		const fields: FormFieldInstance[] = [
			{
				blockType: 'text',
				name: 'code',
				label: 'Code',
				validations: [{ blockType: 'minLength', min: 4 }],
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'code', value: 'ab' }],
		})
		expect(result.errors).toEqual([{ path: 'code', message: 'formBuilder:rule.minLength.message' }])
	})

	it('resolves matchesField against coerced sibling answers', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{
				blockType: 'number',
				name: 'b',
				label: 'B',
				validations: [{ blockType: 'matchesField', field: 'a' }],
			},
		]
		const ok = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'a', value: '5' },
				{ field: 'b', value: '5' },
			],
		})
		expect(ok.errors).toEqual([])
		expect(ok.values).toEqual([
			{ field: 'a', value: 5 },
			{ field: 'b', value: 5 },
		])
	})

	it('skips a hidden field entirely (no validation, no stored value)', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				visibleWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'free' },
				{ field: 'detail', value: '' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'plan', value: 'free' }])
		expect(result.descriptors.map((descriptor) => descriptor.field)).toEqual(['plan'])
	})

	it('validates a visible conditional field', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				visibleWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'pro' },
				{ field: 'detail', value: '' },
			],
		})
		expect(result.errors).toEqual([{ path: 'detail', message: 'formBuilder:validation.required' }])
	})

	it('validateWhen false stores the value but skips validation', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'code',
				label: 'Code',
				validations: [{ blockType: 'minLength', min: 4 }],
				validateWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'plan', value: 'free' },
				{ field: 'code', value: 'ab' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toContainEqual({ field: 'code', value: 'ab' })
	})

	it('fails a file field closed when no uploads collection is configured', async () => {
		const findByID = vi.fn()
		const payload = { findByID } as unknown as Payload
		const fields: FormFieldInstance[] = [{ blockType: 'file', name: 'resume', label: 'Resume' }]
		const result = await runSubmission({
			...base,
			fields,
			values: [{ field: 'resume', value: 'up1' }],
			payload,
		})
		expect(result.errors).toEqual([
			{ path: 'resume', message: 'formBuilder:validation.file.missing' },
		])
		expect(result.values).toEqual([])
		expect(findByID).not.toHaveBeenCalled()
	})

	it('enforces a custom value:file field type at top level (gated on value kind, not blockType)', async () => {
		const attachmentDef: AnyFormFieldDefinition = {
			type: 'attachment',
			label: 'Attachment',
			value: 'file',
		}
		const customRegistry = buildRegistry([...defaultFieldDefinitions, attachmentDef])
		const doc = { id: 'up1', filename: 'a.pdf', mimeType: 'application/pdf', filesize: 100 }
		const findByID = vi.fn().mockResolvedValue(doc)
		const payload = { findByID } as unknown as Payload
		const result = await runSubmission({
			...base,
			registry: customRegistry,
			fields: [{ blockType: 'attachment', name: 'file1', label: 'File' }],
			values: [{ field: 'file1', value: 'up1' }],
			payload,
			uploadSlug: 'app-uploads',
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([
			{
				field: 'file1',
				value: { id: 'up1', filename: 'a.pdf', mimeType: 'application/pdf', filesize: 100 },
			},
		])
		expect(findByID).toHaveBeenCalledWith(
			expect.objectContaining({ collection: 'app-uploads', id: 'up1' })
		)
	})

	describe('file sub-fields inside a repeater', () => {
		const fileSub: FormFieldInstance = { blockType: 'file', name: 'doc', label: 'Doc' }
		const noteSub: FormFieldInstance = { blockType: 'text', name: 'note', label: 'Note' }
		const repeaterWith = (subFields: FormFieldInstance[]): FormFieldInstance[] => [
			{ blockType: 'repeater', name: 'items', label: 'Items', subFields },
		]

		it('captures a valid file sub-field to a FileRef, enforcing owner, and leaves siblings verbatim', async () => {
			const doc = {
				id: 'up1',
				filename: 'r.pdf',
				mimeType: 'application/pdf',
				filesize: 1024,
				owner: 'ip:1.1.1.1',
			}
			const findByID = vi.fn().mockResolvedValue(doc)
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub, noteSub]),
				values: [{ field: 'items', value: [{ doc: 'up1', note: 'hi' }] }],
				payload,
				uploadSlug: 'app-uploads',
				expectedOwner: 'ip:1.1.1.1',
			})
			expect(result.errors).toEqual([])
			const rows = result.values.find((v) => v.field === 'items')?.value as Array<
				Record<string, unknown>
			>
			expect(rows[0]?.doc).toEqual({
				id: 'up1',
				filename: 'r.pdf',
				mimeType: 'application/pdf',
				filesize: 1024,
			})
			expect(rows[0]?.note).toBe('hi')
			expect(findByID).toHaveBeenCalledWith(
				expect.objectContaining({ collection: 'app-uploads', id: 'up1', overrideAccess: true })
			)
		})

		it('fails closed for a forged/nonexistent file id in a repeater row', async () => {
			const findByID = vi.fn().mockRejectedValue(new Error('not found'))
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub]),
				values: [{ field: 'items', value: [{ doc: 'forged' }] }],
				payload,
				uploadSlug: 'app-uploads',
				expectedOwner: 'ip:1.1.1.1',
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.missing' },
			])
			expect(result.values).toEqual([])
		})

		it('rejects an oversized file in a repeater row', async () => {
			const doc = { id: 'up1', filename: 'big.pdf', mimeType: 'application/pdf', filesize: 5000 }
			const findByID = vi.fn().mockResolvedValue(doc)
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([{ ...fileSub, maxSize: 1024 }]),
				values: [{ field: 'items', value: [{ doc: 'up1' }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.tooLarge' },
			])
			expect(result.values).toEqual([])
		})

		it('rejects a wrong-mime file in a repeater row', async () => {
			const doc = { id: 'up1', filename: 'r.pdf', mimeType: 'application/pdf', filesize: 100 }
			const findByID = vi.fn().mockResolvedValue(doc)
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([{ ...fileSub, mimeTypes: ['image/png'] }]),
				values: [{ field: 'items', value: [{ doc: 'up1' }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.mimeType' },
			])
			expect(result.values).toEqual([])
		})

		it('rejects a repeater file owned by a different identity', async () => {
			const doc = {
				id: 'up1',
				filename: 'r.pdf',
				mimeType: 'application/pdf',
				filesize: 100,
				owner: 'ip:other',
			}
			const findByID = vi.fn().mockResolvedValue(doc)
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub]),
				values: [{ field: 'items', value: [{ doc: 'up1' }] }],
				payload,
				uploadSlug: 'app-uploads',
				expectedOwner: 'ip:me',
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.missing' },
			])
			expect(result.values).toEqual([])
		})

		it('leaves non-file sub-values verbatim and skips empty file sub-fields', async () => {
			const findByID = vi.fn()
			const payload = { findByID } as unknown as Payload
			const qtySub: FormFieldInstance = { blockType: 'number', name: 'qty', label: 'Qty' }
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub, noteSub, qtySub]),
				values: [{ field: 'items', value: [{ note: 'keep', qty: 3 }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([])
			const rows = result.values.find((v) => v.field === 'items')?.value as Array<
				Record<string, unknown>
			>
			expect(rows[0]).toEqual({ note: 'keep', qty: 3 })
			expect(findByID).not.toHaveBeenCalled()
		})

		it('enforces each row independently (valid row 0, forged row 1)', async () => {
			const findByID = vi.fn(async ({ id }: { id: string | number }) => {
				if (id === 'good') {
					return { id: 'good', filename: 'g.pdf', mimeType: 'application/pdf', filesize: 100 }
				}
				throw new Error('not found')
			})
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub]),
				values: [{ field: 'items', value: [{ doc: 'good' }, { doc: 'bad' }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([
				{ path: 'items[1].doc', message: 'formBuilder:validation.file.missing' },
			])
			expect(result.values).toEqual([])
		})

		it('fails closed when no uploads collection is configured', async () => {
			const findByID = vi.fn()
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub]),
				values: [{ field: 'items', value: [{ doc: 'up1' }] }],
				payload,
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.missing' },
			])
			expect(result.values).toEqual([])
			expect(findByID).not.toHaveBeenCalled()
		})

		it('leaves a repeater file sub-value verbatim when no payload is available', async () => {
			const result = await runSubmission({
				...base,
				fields: repeaterWith([fileSub]),
				values: [{ field: 'items', value: [{ doc: 'up1' }] }],
			})
			expect(result.errors).toEqual([])
			const rows = result.values.find((v) => v.field === 'items')?.value as Array<
				Record<string, unknown>
			>
			expect(rows[0]?.doc).toBe('up1')
		})

		// Capture must run outside the sub-field's visibleWhen/validateWhen gates: a crafted request
		// could carry an upload id for a conditionally-hidden file sub-field, and it must still be
		// enforced (never stored raw). These lock that invariant against a future refactor that folds
		// capture back inside the validation gate.
		const hiddenFileSub: FormFieldInstance = {
			...fileSub,
			visibleWhen: { or: [{ and: [{ show: { equals: 'yes' } }] }] },
		}

		it('rejects a forged file even when the sub-field is conditionally hidden in the row', async () => {
			const findByID = vi.fn().mockRejectedValue(new Error('not found'))
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([hiddenFileSub]),
				values: [{ field: 'items', value: [{ doc: 'forged', show: 'no' }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([
				{ path: 'items[0].doc', message: 'formBuilder:validation.file.missing' },
			])
			expect(result.values).toEqual([])
			expect(findByID).toHaveBeenCalled()
		})

		it('still captures a valid file when the sub-field is conditionally hidden in the row', async () => {
			const doc = { id: 'up1', filename: 'r.pdf', mimeType: 'application/pdf', filesize: 100 }
			const findByID = vi.fn().mockResolvedValue(doc)
			const payload = { findByID } as unknown as Payload
			const result = await runSubmission({
				...base,
				fields: repeaterWith([hiddenFileSub]),
				values: [{ field: 'items', value: [{ doc: 'up1', show: 'no' }] }],
				payload,
				uploadSlug: 'app-uploads',
			})
			expect(result.errors).toEqual([])
			const rows = result.values.find((v) => v.field === 'items')?.value as Array<
				Record<string, unknown>
			>
			expect(rows[0]?.doc).toEqual({
				id: 'up1',
				filename: 'r.pdf',
				mimeType: 'application/pdf',
				filesize: 100,
			})
		})

		it('does not store a client-injected value under a display-only sub-field name', async () => {
			const infoSub: FormFieldInstance = { blockType: 'message', name: 'info', label: 'Info' }
			const result = await runSubmission({
				...base,
				fields: repeaterWith([noteSub, infoSub]),
				values: [{ field: 'items', value: [{ note: 'keep', info: 'INJECTED' }] }],
			})
			expect(result.errors).toEqual([])
			const rows = result.values.find((v) => v.field === 'items')?.value as Array<
				Record<string, unknown>
			>
			expect(rows[0]).toEqual({ note: 'keep' })
			expect(rows[0]).not.toHaveProperty('info')
		})
	})
})
