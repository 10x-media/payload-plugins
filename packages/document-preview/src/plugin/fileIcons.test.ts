import type { Field, FieldHook, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { FILE_ICONS_VERSION } from '../shared/fileIcons'
import { fileIconEndpoint, fileIconUrl, withFileIconThumbnail } from './fileIcons'

const hookOf = (fields: Field[]): FieldHook => {
	const field = fields.find((candidate) => 'name' in candidate && candidate.name === 'thumbnailURL')
	const hooks = (field as { hooks?: { afterRead?: FieldHook[] } }).hooks?.afterRead ?? []
	const hook = hooks.at(-1)
	if (!hook) {
		throw new Error('no afterRead hook on thumbnailURL')
	}
	return hook
}

const read = (hook: FieldHook, value: unknown, siblingData: Record<string, unknown>) =>
	hook({ siblingData, value } as Parameters<FieldHook>[0])

describe('withFileIconThumbnail', () => {
	const hook = hookOf(withFileIconThumbnail([], '/api'))

	it('fills an empty thumbnail on a non-image file with its family icon', () => {
		expect(read(hook, null, { filename: 'a.docx', mimeType: 'application/msword' })).toBe(
			fileIconUrl('/api', 'word')
		)
		expect(read(hook, undefined, { filename: 'data.json', mimeType: 'application/json' })).toBe(
			`/api/document-preview/file-icon/json?v=${FILE_ICONS_VERSION}`
		)
	})

	it('keeps any value already computed, and leaves images empty', () => {
		expect(read(hook, '/custom.png', { filename: 'a.pdf', mimeType: 'application/pdf' })).toBe(
			'/custom.png'
		)
		expect(read(hook, null, { filename: 'a.png', mimeType: 'image/png' })).toBeNull()
		// A `select` that leaves out mimeType: the extension decides.
		expect(read(hook, null, { filename: 'photo.jpg' })).toBeNull()
		expect(read(hook, null, { filename: 'bundle.zip' })).toBe(fileIconUrl('/api', 'archive'))
		expect(read(hook, null, {})).toBeNull()
	})

	it('runs after hooks a collection already declares on thumbnailURL', () => {
		const own: FieldHook = ({ value }) => value
		const fields = withFileIconThumbnail(
			[{ name: 'thumbnailURL', type: 'text', hooks: { afterRead: [own] } }],
			'/api'
		)
		const hooks = (fields[0] as { hooks: { afterRead: FieldHook[] } }).hooks.afterRead
		expect(hooks).toHaveLength(2)
		expect(hooks[0]).toBe(own)
	})
})

describe('fileIconEndpoint', () => {
	const call = (kind: string, user: unknown) =>
		fileIconEndpoint.handler({ routeParams: { kind }, user } as unknown as PayloadRequest)

	it('refuses anonymous requests', async () => {
		expect((await call('pdf', null)).status).toBe(401)
	})

	it('rejects unknown families', async () => {
		expect((await call('exe', { id: 1 })).status).toBe(404)
	})

	it('serves the icon with a private, long-lived cache', async () => {
		const response = await call('pdf', { id: 1 })
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('image/svg+xml')
		expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
		expect(await response.text()).toContain('PDF')
	})
})
