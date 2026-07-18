import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { FieldTypeRegistry } from '../fields/registry'
import type { AnyFormFieldDefinition, ResolveFieldOptionsArgs } from '../fields/types'
import type { PollOption } from './definePollOptionSource'
import { definePollOptionSource } from './definePollOptionSource'
import { resolveEffectivePollOptions } from './effectivePollOptions'
import type { PollOptionSourceRegistry } from './registry'

const payload = { config: { custom: {} } } as unknown as Payload

const staticForm = (poll: Record<string, unknown> | undefined) => ({
	id: 1,
	title: 'Race',
	pollEnabled: poll?.enabled === true,
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

const registryWith = (definition: AnyFormFieldDefinition): FieldTypeRegistry =>
	new Map([[definition.type, definition]])

const athleteVoteDefinition = (
	resolveOptions: AnyFormFieldDefinition['resolveOptions']
): AnyFormFieldDefinition => ({
	type: 'athleteVote',
	label: 'Athlete vote',
	value: 'text',
	pollEligible: true,
	resolveOptions,
})

const voteForm = (poll: Record<string, unknown> | undefined) => ({
	id: 7,
	title: 'Athlete vote',
	pollEnabled: poll?.enabled === true,
	poll,
	fields: [
		{ blockType: 'athleteVote', name: 'pick', label: 'Pick', athleteIds: ['a1', 'a2'] },
		{ blockType: 'text', name: 'note', label: 'Note' },
	],
})

describe('resolveEffectivePollOptions resolveOptions branch', () => {
	it("calls the results field definition's resolveOptions with the live instance", async () => {
		const resolveOptions = vi.fn((args: ResolveFieldOptionsArgs): PollOption[] => {
			const ids = Array.isArray(args.instance.athleteIds)
				? (args.instance.athleteIds as string[])
				: []
			return ids.map((id) => ({ value: id, label: id.toUpperCase() }))
		})
		const options = await resolveEffectivePollOptions({
			payload,
			form: voteForm({ enabled: true, resultsField: 'pick' }),
			fieldTypes: registryWith(athleteVoteDefinition(resolveOptions)),
		})
		expect(options).toEqual([
			{ value: 'a1', label: 'A1' },
			{ value: 'a2', label: 'A2' },
		])
		expect(resolveOptions).toHaveBeenCalledTimes(1)
		const call = resolveOptions.mock.calls[0]?.[0]
		expect(call?.instance).toMatchObject({ name: 'pick', athleteIds: ['a1', 'a2'] })
		expect(call?.form).toEqual({ id: 7, title: 'Athlete vote' })
		expect(call?.payload).toBe(payload)
	})

	it('prefers an option source over a definition resolveOptions', async () => {
		const resolveOptions = vi.fn((): PollOption[] => [{ value: 'x', label: 'X' }])
		const options = await resolveEffectivePollOptions({
			payload,
			form: voteForm({ enabled: true, resultsField: 'pick', optionSource: 'athletes' }),
			sources,
			fieldTypes: registryWith(athleteVoteDefinition(resolveOptions)),
		})
		expect(options).toEqual([{ label: 'Linus', value: 'linus' }])
		expect(resolveOptions).not.toHaveBeenCalled()
	})

	it('falls back to the instance authored options when the definition has no resolveOptions', async () => {
		const options = await resolveEffectivePollOptions({
			payload,
			form: staticForm({ enabled: true, resultsField: 'winner' }),
			fieldTypes: registryWith({
				type: 'select',
				label: 'Select',
				value: 'text',
				pollEligible: true,
			}),
		})
		expect(options).toEqual([
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		])
	})

	it('caches the resolver result per request, keyed by form id', async () => {
		const resolveOptions = vi.fn((): PollOption[] => [{ value: 'a1', label: 'A1' }])
		const req = { context: {} } as unknown as PayloadRequest
		const args = {
			payload,
			req,
			form: voteForm({ enabled: true, resultsField: 'pick' }),
			fieldTypes: registryWith(athleteVoteDefinition(resolveOptions)),
		}
		await resolveEffectivePollOptions(args)
		await resolveEffectivePollOptions(args)
		expect(resolveOptions).toHaveBeenCalledTimes(1)
	})
})
