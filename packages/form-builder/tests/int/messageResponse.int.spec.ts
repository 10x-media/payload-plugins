import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

const lexical = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

// Empty options: runs on Mongo by default and on both DBs under the matrix tier (DB_MATRIX),
// proving the row-id trust boundary and id-keyed flow normalization cross-DB.
describeForDb('form-builder message field + response settings', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('round-trips a message-type response with rich text', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Response message',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				response: {
					type: 'message',
					message: lexical('Thanks!'),
				},
			},
		})
		const response = form.response as {
			type?: string
			message?: unknown
		}
		expect(response.type).toBe('message')
		expect(response.message).toMatchObject(lexical('Thanks!'))
	})

	it('round-trips a redirect-type response and validates the URL', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Response redirect',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				response: {
					type: 'redirect',
					redirect: { url: 'https://example.com/thanks' },
				},
			},
		})
		expect((form.response as { redirect?: { url?: string } }).redirect?.url).toBe(
			'https://example.com/thanks'
		)

		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Bad redirect',
					response: { type: 'redirect', redirect: { url: 'javascript:alert(1)' } },
				},
			})
		).rejects.toThrow()
	})

	it('authors a nameless message block and stores its content with the row id intact', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Message block',
				fields: [
					{ blockType: 'text', name: 'first', label: 'First' },
					{ blockType: 'message', id: 'msg-row-1', content: lexical('Read me') },
					{ blockType: 'text', name: 'last', label: 'Last' },
				],
			},
		})
		const note = (form.fields as { blockType: string; id?: string; content?: unknown }[]).find(
			(f) => f.blockType === 'message'
		)
		expect(note?.content).toMatchObject(lexical('Read me'))
		expect(note?.id).toBe('msg-row-1')
	})

	it('normalizes a flow that assigns a bare message by its row id', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Flow with bare message',
				fields: [
					{ blockType: 'text', name: 'first', label: 'First' },
					{ blockType: 'message', id: 'msg-row-2', content: lexical('Step two note') },
					{ blockType: 'text', name: 'last', label: 'Last' },
				],
				flow: {
					steps: [
						{ id: 's1', fields: ['first'], next: 's2' },
						{ id: 's2', fields: ['msg-row-2', 'last'] },
					],
				},
			},
		})
		const flow = form.flow as { steps: { id: string; fields: string[] }[] }
		expect(flow.steps[0]?.fields).toEqual(['first'])
		expect(flow.steps[1]?.fields).toEqual(['msg-row-2', 'last'])
	})

	it('a submission stores only the surrounding answers: no message key, no validation', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Message submission',
				fields: [
					{ blockType: 'text', name: 'first', label: 'First' },
					{
						blockType: 'message',
						id: 'msg-row-3',
						content: lexical('Between'),
					},
					{ blockType: 'text', name: 'last', label: 'Last' },
				],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [
					{ field: 'first', value: 'a' },
					{ field: 'msg-row-3', value: 'client-injected' },
					{ field: 'note', value: 'stray' },
					{ field: 'last', value: 'b' },
				],
			},
		})
		expect(submission.values).toEqual([
			{ field: 'first', value: 'a' },
			{ field: 'last', value: 'b' },
		])
		const descriptors = submission.descriptors as { field: string }[]
		expect(descriptors.map((d) => d.field)).toEqual(['first', 'last'])
	})
})
