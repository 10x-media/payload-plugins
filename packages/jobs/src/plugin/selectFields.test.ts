import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	collectJobSelectSlugs,
	jobSelectField,
	taskCondition,
	unionSelectValues,
	workflowCondition,
} from './selectFields'

const config = {
	jobs: {
		autoRun: [{ cron: '* * * * *', queue: 'nightly' }],
		tasks: [{ slug: 'sendEmail' }, { slug: 'syncCrm' }],
		workflows: [{ slug: 'onboarding' }],
	},
} as unknown as Config

describe('collectJobSelectSlugs', () => {
	it('collects task, workflow, and queue slugs from the config', () => {
		const slugs = collectJobSelectSlugs(config, ['emails'])
		expect(slugs.tasks).toEqual(['sendEmail', 'syncCrm'])
		expect(slugs.workflows).toEqual(['onboarding'])
		expect(slugs.queues).toEqual(['default', 'emails', 'nightly'])
	})

	it('handles a function autoRun and missing jobs config', () => {
		const slugs = collectJobSelectSlugs({
			jobs: { autoRun: () => [], tasks: [] },
		} as unknown as Config)
		expect(slugs.queues).toEqual(['default'])
		expect(slugs.workflows).toEqual([])
	})
})

describe('jobSelectField', () => {
	it('converts a text field to a select with the given values', () => {
		const field = jobSelectField({ name: 'queue', type: 'text' }, ['default', 'emails'])
		expect(field.type).toBe('select')
		expect((field as { options: unknown }).options).toEqual([
			{ label: 'default', value: 'default' },
			{ label: 'emails', value: 'emails' },
		])
	})
})

describe('unionSelectValues', () => {
	it('keeps existing select option values ahead of merged ones, deduplicated', () => {
		const field = {
			name: 'taskSlug',
			type: 'select',
			options: ['inline', { label: 'sendEmail', value: 'sendEmail' }],
		} as unknown as Parameters<typeof unionSelectValues>[0]
		expect(unionSelectValues(field, ['sendEmail', 'syncCrm'])).toEqual([
			'inline',
			'sendEmail',
			'syncCrm',
		])
	})

	it('returns only the given values for a non-select field', () => {
		expect(unionSelectValues({ name: 'queue', type: 'text' }, ['default'])).toEqual(['default'])
	})
})

describe('XOR conditions', () => {
	const ctx = (operation: 'create' | 'update') => ({ operation }) as never

	it('hides workflow on create once a task is chosen, and vice versa', () => {
		expect(workflowCondition(1)({}, { taskSlug: 'sendEmail' }, ctx('create'))).toBe(false)
		expect(workflowCondition(1)({}, {}, ctx('create'))).toBe(true)
		expect(taskCondition(2)({}, { workflowSlug: 'onboarding' }, ctx('create'))).toBe(false)
	})

	it('hides an optionless select on create', () => {
		expect(workflowCondition(0)({}, {}, ctx('create'))).toBe(false)
	})

	it('shows only the populated side on edit', () => {
		expect(workflowCondition(1)({ workflowSlug: 'onboarding' }, {}, ctx('update'))).toBe(true)
		expect(workflowCondition(1)({}, {}, ctx('update'))).toBe(false)
		expect(taskCondition(2)({ taskSlug: 'sendEmail' }, {}, ctx('update'))).toBe(true)
	})
})
