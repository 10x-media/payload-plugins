import type { RichTextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { runSubmission } from '../../submissions/runSubmission'
import type { FormFieldInstance } from '../../submissions/types'
import { buildRuleRegistry } from '../../validation/registry'
import { buildRegistry } from '../registry'
import { buildDefaultFieldDefinitions, defaultFieldDefinitions } from './index'
import { buildMessageField, messageField } from './message'

const registry = buildRegistry(defaultFieldDefinitions)
const ruleRegistry = buildRuleRegistry([])
const base = {
	registry,
	ruleRegistry,
	locale: 'en',
	t: (key: string) => key,
	operation: 'create' as const,
}

describe('messageField', () => {
	it('has type "message", value kind "none", and is bare', () => {
		expect(messageField.type).toBe('message')
		expect(messageField.value).toBe('none')
		expect(messageField.bare).toBe(true)
	})

	it('is registered as a built-in', () => {
		expect(registry.get('message')).toBeDefined()
	})

	it('config is a single richText content field with no editor key by default', () => {
		const config = messageField.config ?? []
		expect(config).toHaveLength(1)
		const content = config[0] as { name?: string; type?: string; editor?: unknown }
		expect(content.name).toBe('content')
		expect(content.type).toBe('richText')
		expect('editor' in content).toBe(false)
	})

	it('threads a given editor onto the content field', () => {
		const editor = { fake: 'editor' } as unknown as RichTextField['editor']
		const content = buildMessageField(true, editor).config?.[0] as { editor?: unknown }
		expect(content.editor).toBe(editor)
	})

	it('content is localized when localize is true, not when false', () => {
		const localized = buildMessageField(true).config?.[0] as { localized?: boolean }
		const plain = buildMessageField(false).config?.[0] as { localized?: boolean }
		expect(localized.localized).toBe(true)
		expect('localized' in plain).toBe(false)
	})

	it('carries no validate/format: nothing for the engine to run', () => {
		expect(messageField.validate).toBeUndefined()
		expect(messageField.format).toBeUndefined()
	})
})

describe('runSubmission with a nameless message block', () => {
	const fields: FormFieldInstance[] = [
		{ blockType: 'text', name: 'first', label: 'First' },
		{ blockType: 'message', id: 'row-note', content: { root: { children: [] } } },
		{ blockType: 'text', name: 'last', label: 'Last' },
	]

	it('stores only the surrounding answers, never a message key', async () => {
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'first', value: 'a' },
				{ field: 'last', value: 'b' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([
			{ field: 'first', value: 'a' },
			{ field: 'last', value: 'b' },
		])
		expect(result.descriptors.map((d) => d.field)).toEqual(['first', 'last'])
	})

	it('drops a client-sent value aimed at the message row (by row id or any stray key)', async () => {
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'first', value: 'a' },
				{ field: 'row-note', value: '<script>alert(1)</script>' },
				{ field: 'note', value: 'stray' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'first', value: 'a' }])
	})

	it('never validates a message block, even when row data claims required', async () => {
		const requiredMessage: FormFieldInstance[] = [
			{ blockType: 'message', id: 'row-note', required: true },
		]
		const result = await runSubmission({ ...base, fields: requiredMessage, values: [] })
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([])
	})

	it('still drops values under a legacy named message row', async () => {
		const legacy: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'message', name: 'note', content: { root: { children: [] } } },
		]
		const result = await runSubmission({
			...base,
			fields: legacy,
			values: [
				{ field: 'first', value: 'a' },
				{ field: 'note', value: 'client-injected' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'first', value: 'a' }])
	})

	it('localize flag threads through buildDefaultFieldDefinitions', () => {
		const withLocalization = buildDefaultFieldDefinitions(true).find((d) => d.type === 'message')
		const without = buildDefaultFieldDefinitions(false).find((d) => d.type === 'message')
		expect((withLocalization?.config?.[0] as { localized?: boolean }).localized).toBe(true)
		expect('localized' in (without?.config?.[0] as object)).toBe(false)
	})

	it('editor threads through buildDefaultFieldDefinitions to message', () => {
		const editor = { fake: 'editor' } as unknown as RichTextField['editor']
		const message = buildDefaultFieldDefinitions(true, editor).find((d) => d.type === 'message')
		expect((message?.config?.[0] as { editor?: unknown }).editor).toBe(editor)
	})
})
