import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { definePollOptionSource } from './definePollOptionSource'
import { resolveEffectivePollOptions } from './effectivePollOptions'
import type { PollOptionSourceRegistry } from './registry'

const payload = { config: { custom: {} } } as unknown as Payload

const staticForm = (poll: Record<string, unknown> | undefined) => ({
	id: 1,
	title: 'Race',
	poll,
	fields: [
		{
			blockType: 'select',
			name: 'winner',
			label: 'Winner',
			options: [
				{ label: 'Ada', value: 'ada' },
				{ label: 'Grace', value: 'grace' },
			],
		},
		{ blockType: 'text', name: 'note', label: 'Note' },
	],
})

const sources: PollOptionSourceRegistry = new Map([
	[
		'athletes',
		definePollOptionSource({
			type: 'athletes',
			label: 'Athletes',
			resolve: ({ config }) => {
				if (config.fail === true) {
					throw new Error('source down')
				}
				return [{ label: 'Linus', value: 'linus' }]
			},
		}),
	],
])

describe('resolveEffectivePollOptions', () => {
	it('returns the authored options of the results field instance', async () => {
		const options = await resolveEffectivePollOptions({
			payload,
			form: staticForm({ enabled: true, resultsField: 'winner' }),
		})
		expect(options).toEqual([
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		])
	})

	it('returns source-resolved options when an option source is configured', async () => {
		const options = await resolveEffectivePollOptions({
			payload,
			form: staticForm({ enabled: true, resultsField: 'winner', optionSource: 'athletes' }),
			sources,
		})
		expect(options).toEqual([{ label: 'Linus', value: 'linus' }])
	})

	it('propagates a source resolution failure', async () => {
		await expect(
			resolveEffectivePollOptions({
				payload,
				form: staticForm({
					enabled: true,
					resultsField: 'winner',
					optionSource: 'athletes',
					sourceConfig: { fail: true },
				}),
				sources,
			})
		).rejects.toThrow(/source down/)
	})

	it('is empty when the poll is disabled or absent', async () => {
		expect(
			await resolveEffectivePollOptions({
				payload,
				form: staticForm({ enabled: false, resultsField: 'winner' }),
			})
		).toEqual([])
		expect(await resolveEffectivePollOptions({ payload, form: staticForm(undefined) })).toEqual([])
	})

	it('is empty without a results field, for an unknown instance, and for an option-less instance', async () => {
		expect(
			await resolveEffectivePollOptions({ payload, form: staticForm({ enabled: true }) })
		).toEqual([])
		expect(
			await resolveEffectivePollOptions({
				payload,
				form: staticForm({ enabled: true, resultsField: 'missing' }),
			})
		).toEqual([])
		expect(
			await resolveEffectivePollOptions({
				payload,
				form: staticForm({ enabled: true, resultsField: 'note' }),
			})
		).toEqual([])
	})
})
