import type { RichTextField, TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { encryptedField } from './encryptedField'
import { getEncryptedMarker } from './types'

describe('encryptedField factory shape', () => {
	it('returns a single text-backed field for non-queryable config', () => {
		const fields = encryptedField({ name: 'ssn', required: true, type: 'text' })
		expect(fields).toHaveLength(1)
		const stored = fields[0] as TextField
		expect(stored.type).toBe('text')
		expect(stored.name).toBe('ssn')
		expect(stored.required).toBe(true)
		expect(stored.hooks?.beforeChange).toHaveLength(1)
		expect(stored.hooks?.afterRead).toHaveLength(1)
		expect(typeof stored.validate).toBe('function')
		expect(stored.typescriptSchema).toHaveLength(1)
		expect(getEncryptedMarker(stored)?.sourceType).toBe('text')
	})

	it('appends an admin-hidden, queryable, response-stripped bidx sibling when queryable', () => {
		const fields = encryptedField({ name: 'contact', type: 'email' }, { queryable: true })
		expect(fields).toHaveLength(2)
		const bidx = fields[1] as TextField
		expect(bidx.name).toBe('contact_bidx')
		// admin.hidden (not top-level hidden) keeps the field in the flattened
		// schema so a rewritten `equals` query passes Payload's query-path validation.
		expect(bidx.hidden).toBeUndefined()
		expect(bidx.admin?.hidden).toBe(true)
		expect(bidx.admin?.disableListFilter).toBe(true)
		expect(bidx.admin?.disableListColumn).toBe(true)
		// The keyed hash is stripped from responses by the plugin's collection
		// afterRead (withEncryptedQueryRewrite), not a field hook, so the bidx
		// stays queryable and carries no hooks of its own.
		expect(bidx.hooks).toBeUndefined()
		expect(bidx.index).toBe(true)
		expect(bidx.unique).toBeUndefined()
		expect(getEncryptedMarker(fields[0] as TextField)?.bidxName).toBe('contact_bidx')
		expect(getEncryptedMarker(fields[0] as TextField)?.normalize).toBe('email')
	})

	it('moves unique onto the bidx field (ciphertext uniqueness is meaningless)', () => {
		const fields = encryptedField(
			{ name: 'contact', type: 'email', unique: true },
			{ queryable: true }
		)
		const stored = fields[0] as TextField
		const bidx = fields[1] as TextField
		expect(stored.unique).toBeUndefined()
		expect(bidx.unique).toBe(true)
	})

	it('rejects unique without queryable', () => {
		expect(() => encryptedField({ name: 'x', type: 'email', unique: true })).toThrow(/queryable/)
	})

	it('rejects queryable + hasMany', () => {
		expect(() =>
			encryptedField({ hasMany: true, name: 'tags', type: 'text' }, { queryable: true })
		).toThrow(/hasMany/)
	})

	it('rejects queryable on non-scalar field types (M2: blind index requires a scalar)', () => {
		expect(() => encryptedField({ name: 'when', type: 'date' }, { queryable: true })).toThrow(
			/scalar/
		)
		expect(() =>
			encryptedField({ name: 'tier', options: ['a', 'b'], type: 'select' }, { queryable: true })
		).toThrow(/scalar/)
		expect(() => encryptedField({ name: 'active', type: 'checkbox' }, { queryable: true })).toThrow(
			/scalar/
		)
	})

	it('allows queryable on text, email, and number', () => {
		expect(encryptedField({ name: 'a', type: 'text' }, { queryable: true })).toHaveLength(2)
		expect(encryptedField({ name: 'b', type: 'email' }, { queryable: true })).toHaveLength(2)
		expect(encryptedField({ name: 'c', type: 'number' }, { queryable: true })).toHaveLength(2)
	})

	it('returns a virtual editor field plus a hidden ciphertext sibling for richText', () => {
		const fields = encryptedField({ name: 'body', required: true, type: 'richText' })
		expect(fields).toHaveLength(2)
		const editor = fields[0] as RichTextField
		const cipher = fields[1] as TextField
		expect(editor.type).toBe('richText')
		expect(editor.name).toBe('body')
		expect(editor.virtual).toBe(true)
		// readOnly:false is required or sanitize forces a virtual affectsData field readOnly.
		expect(editor.admin?.readOnly).toBe(false)
		// editor is omitted so it inherits config.editor (full app parity).
		expect('editor' in editor).toBe(false)
		expect(editor.hooks?.afterRead).toHaveLength(1)
		expect(editor.hooks?.beforeChange).toHaveLength(1)
		expect(typeof editor.validate).toBe('function')
		// The virtual editor field carries no marker; the marker lives on the sibling.
		expect(getEncryptedMarker(editor as { custom?: Record<string, unknown> })).toBeUndefined()

		expect(cipher.type).toBe('text')
		expect(cipher.name).toBe('body_encrypted')
		// admin.hidden (not top-level hidden) keeps the value readable by the decrypt hook.
		expect(cipher.hidden).toBeUndefined()
		expect(cipher.admin?.hidden).toBe(true)
		expect(cipher.hooks?.afterRead).toBeUndefined()
		expect(cipher.hooks?.beforeChange).toHaveLength(1)
		const marker = getEncryptedMarker(cipher)
		expect(marker?.sourceType).toBe('richText')
		expect(marker?.fieldName).toBe('body')
	})

	it('masked richText overrides the editor Field with the ProtectedRichText RSC', () => {
		const [editor] = encryptedField({ name: 'body', type: 'richText' }) as [RichTextField]
		const component = editor.admin?.components?.Field as {
			path: string
			serverProps: { protection: string }
		}
		expect(component.path).toBe('@10x-media/fields/rsc#ProtectedRichText')
		expect(component.serverProps.protection).toBe('masked')
	})

	it("protection 'none' richText renders the real editor directly (no Field override)", () => {
		const [editor] = encryptedField({ name: 'body', type: 'richText' }, { protection: 'none' }) as [
			RichTextField,
		]
		expect(editor.admin?.components?.Field).toBeUndefined()
	})

	it('mirrors localized onto the richText ciphertext sibling', () => {
		const fields = encryptedField({ localized: true, name: 'body', type: 'richText' })
		const cipher = fields[1] as TextField
		expect(cipher.localized).toBe(true)
		expect(getEncryptedMarker(cipher)?.localized).toBe(true)
	})

	it('preserves user hooks around ours (seal last on write, unseal first on read)', () => {
		const userBeforeChange = () => undefined
		const userAfterRead = () => undefined
		const fields = encryptedField({
			hooks: { afterRead: [userAfterRead], beforeChange: [userBeforeChange] },
			name: 'ssn',
			type: 'text',
		})
		const stored = fields[0] as TextField
		expect(stored.hooks?.beforeChange?.[0]).toBe(userBeforeChange)
		expect(stored.hooks?.beforeChange).toHaveLength(2)
		expect(stored.hooks?.afterRead?.[1]).toBe(userAfterRead)
		expect(stored.hooks?.afterRead).toHaveLength(2)
	})

	it('wires the ProtectedField dispatcher with serializable clientProps', () => {
		const fields = encryptedField(
			{ name: 'tier', options: ['a', { label: 'B', value: 'b' }], type: 'select' },
			{ protection: 'none' }
		)
		const stored = fields[0] as TextField
		const component = stored.admin?.components?.Field as {
			clientProps: Record<string, unknown>
			path: string
		}
		expect(component.path).toBe('@10x-media/fields/client#ProtectedField')
		expect(component.clientProps.protection).toBe('none')
		expect(component.clientProps.fieldPatch).toEqual({
			admin: {},
			options: [
				{ label: 'a', value: 'a' },
				{ label: 'B', value: 'b' },
			],
			type: 'select',
		})
		expect(stored.admin?.components?.Cell).toBeUndefined()
	})

	it('masked protection adds the ProtectedCell and defaults on', () => {
		const fields = encryptedField({ name: 'ssn', type: 'text' })
		const stored = fields[0] as TextField
		const cell = stored.admin?.components?.Cell as { path: string }
		expect(cell.path).toBe('@10x-media/fields/rsc#ProtectedCell')
	})

	it('strips index from the stored ciphertext column', () => {
		const fields = encryptedField({ index: true, name: 'ssn', type: 'text' })
		expect((fields[0] as TextField).index).toBeUndefined()
	})

	it('rejects function option labels (clientProps must serialize)', () => {
		expect(() =>
			encryptedField({
				name: 'tier',
				options: [{ label: () => 'nope', value: 'x' } as never],
				type: 'select',
			})
		).toThrow(/label/)
	})

	it('applies function-form overrides to the stored field', () => {
		const fields = encryptedField(
			{ name: 'ssn', type: 'text' },
			{ overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }) }
		)
		expect((fields[0] as TextField).admin?.width).toBe('50%')
	})

	it('validates a custom KeysConfig at factory time', () => {
		expect(() =>
			encryptedField({ name: 'ssn', type: 'text' }, { keys: { active: 'k9', keys: { k1: 'x' } } })
		).toThrow(/active key/)
	})

	it('strips defaultValue and source-type-only constraints from the stored column (L1, L3)', () => {
		const storedOf = (source: Parameters<typeof encryptedField>[0]): Record<string, unknown> =>
			encryptedField(source)[0] as unknown as Record<string, unknown>

		// A static defaultValue would emit a PLAINTEXT column default in drizzle.
		const textStored = storedOf({
			defaultValue: 'seed',
			maxLength: 10,
			minLength: 2,
			name: 'code',
			type: 'text',
		})
		expect('defaultValue' in textStored).toBe(false)
		expect('minLength' in textStored).toBe(false)
		expect('maxLength' in textStored).toBe(false)

		const numberStored = storedOf({ max: 100, min: 1, name: 'amount', type: 'number' })
		expect('min' in numberStored).toBe(false)
		expect('max' in numberStored).toBe(false)

		const selectStored = storedOf({ name: 'tier', options: ['a', 'b'], type: 'select' })
		expect('options' in selectStored).toBe(false)
	})
})
