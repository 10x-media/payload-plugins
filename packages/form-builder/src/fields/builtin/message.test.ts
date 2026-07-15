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
	consentRegistry: new Map(),
	locale: 'en',
	t: (key: string) => key,
	operation: 'create' as const,
}

describe('messageField', () => {
	it('has type "message" and value kind "none"', () => {
		expect(messageField.type).toBe('message')
		expect(messageField.value).toBe('none')
	})

	it('is registered as a built-in', () => {
		expect(registry.get('message')).toBeDefined()
	})

	it('config is a single richText content field with no editor key', () => {
		const config = messageField.config ?? []
		expect(config).toHaveLength(1)
		const content = config[0] as { name?: string; type?: string; editor?: unknown }
		expect(content.name).toBe('content')
		expect(content.type).toBe('richText')
		expect('editor' in content).toBe(false)
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

describe('runSubmission with a message field', () => {
	const fields: FormFieldInstance[] = [
		{ blockType: 'text', name: 'first', label: 'First' },
		{ blockType: 'message', name: 'note', label: 'Note', content: { root: { children: [] } } },
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

	it('drops a client-sent value under the message field name', async () => {
		const result = await runSubmission({
			...base,
			fields,
			values: [
				{ field: 'first', value: 'a' },
				{ field: 'note', value: '<script>alert(1)</script>' },
			],
		})
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([{ field: 'first', value: 'a' }])
	})

	it('never validates a message field, even when marked required', async () => {
		const requiredMessage: FormFieldInstance[] = [
			{ blockType: 'message', name: 'note', label: 'Note', required: true },
		]
		const result = await runSubmission({ ...base, fields: requiredMessage, values: [] })
		expect(result.errors).toEqual([])
		expect(result.values).toEqual([])
	})

	it('localize flag threads through buildDefaultFieldDefinitions', () => {
		const withLocalization = buildDefaultFieldDefinitions(true).find((d) => d.type === 'message')
		const without = buildDefaultFieldDefinitions(false).find((d) => d.type === 'message')
		expect((withLocalization?.config?.[0] as { localized?: boolean }).localized).toBe(true)
		expect('localized' in (without?.config?.[0] as object)).toBe(false)
	})
})
