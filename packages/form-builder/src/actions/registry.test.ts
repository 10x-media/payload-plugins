import { describe, expect, it } from 'vitest'
import type { AnyActionDefinition } from './defineAction'
import { resolveActions } from './registry'

const noop = () => {}

const emailAction: AnyActionDefinition = { type: 'email', label: 'Send Email', run: noop }
const webhookAction: AnyActionDefinition = { type: 'webhook', label: 'Webhook', run: noop }
const slackAction: AnyActionDefinition = { type: 'slack', label: 'Slack', run: noop }

const defaults: Record<string, AnyActionDefinition> = {
	email: emailAction,
	webhook: webhookAction,
}

describe('resolveActions', () => {
	it('returns all defaults when config is empty', () => {
		const registry = resolveActions(defaults)
		expect(registry.size).toBe(2)
		expect(registry.get('email')).toBe(emailAction)
		expect(registry.get('webhook')).toBe(webhookAction)
	})

	it('removes a built-in when set to false', () => {
		const registry = resolveActions(defaults, { email: false })
		expect(registry.has('email')).toBe(false)
		expect(registry.has('webhook')).toBe(true)
	})

	it('keeps a built-in when set to true', () => {
		const registry = resolveActions(defaults, { email: true })
		expect(registry.get('email')).toBe(emailAction)
		expect(registry.size).toBe(2)
	})

	it('true is a no-op for a type with no default', () => {
		const registry = resolveActions(defaults, { unknown: true })
		expect(registry.has('unknown')).toBe(false)
		expect(registry.size).toBe(2)
	})

	it('adds a new definition that is not in defaults', () => {
		const registry = resolveActions(defaults, { slack: slackAction })
		expect(registry.get('slack')).toMatchObject(slackAction)
		expect(registry.size).toBe(3)
	})

	it('replaces an existing built-in with a new definition', () => {
		const custom: AnyActionDefinition = { type: 'email', label: 'Custom Email', run: noop }
		const registry = resolveActions(defaults, { email: custom })
		expect(registry.get('email')).toMatchObject(custom)
		expect(registry.size).toBe(2)
	})

	it('handles multiple operations together', () => {
		const registry = resolveActions(defaults, {
			email: false,
			slack: slackAction,
		})
		expect(registry.has('email')).toBe(false)
		expect(registry.get('webhook')).toBe(webhookAction)
		expect(registry.get('slack')).toMatchObject(slackAction)
		expect(registry.size).toBe(2)
	})

	it('forces the definition type to the config key, so authoring and lookup agree', () => {
		const custom: AnyActionDefinition = { type: 'wrong', label: 'Custom', run: noop }
		const registry = resolveActions(defaults, { correct: custom })
		expect(registry.get('correct')?.type).toBe('correct')
		expect(registry.get('correct')?.label).toBe('Custom')
	})
})
