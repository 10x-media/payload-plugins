import type { ActionDefinition } from '@10x-media/form-builder/types'
import type {
	Field,
	LabelFunction,
	NumberField,
	Payload,
	TextField,
	TextFieldSingleValidation,
} from 'payload'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
	AnalyticsTrackError,
	type ServerEventInput,
	type ServerTrackOptions,
} from '../native/ingest/serverTrack'
import { keys } from '../translations/keys'
import {
	type GoalActionDefinition,
	type GoalActionRunArgs,
	trackGoalAction,
} from './trackGoalAction'

const tracked = vi.hoisted((): Array<{ event: ServerEventInput; opts?: ServerTrackOptions }> => [])

vi.mock('../native/ingest/serverTrack', async (importActual) => {
	const actual = await importActual<typeof import('../native/ingest/serverTrack')>()
	return {
		...actual,
		trackServerEvent: async (
			_payload: Payload,
			event: ServerEventInput,
			opts?: ServerTrackOptions
		): Promise<void> => {
			tracked.push({ event, opts })
		},
	}
})

const payload = {} as Payload

const fieldNamed = (fields: Field[], name: string): Field => {
	const field = fields.find((candidate) => 'name' in candidate && candidate.name === name)
	if (!field) throw new Error(`no config field named ${name}`)
	return field
}

const resolveLabel = (field: Field): string => {
	const label = (field as { label?: LabelFunction | string }).label
	if (typeof label === 'string') return label
	if (!label) throw new Error('field has no label')
	return label({ i18n: {} as never, t: ((key: string) => key) as never })
}

const runArgs = (overrides: Partial<GoalActionRunArgs> = {}): GoalActionRunArgs => ({
	form: { id: 7, title: 'Demo request' },
	submissionId: 42,
	values: [],
	config: { goal: 'book-demo' },
	payload,
	...overrides,
})

const withHost = (host: string): { req: GoalActionRunArgs['req'] } => ({
	req: { headers: new Headers({ host }) } as GoalActionRunArgs['req'],
})

beforeEach(() => {
	tracked.length = 0
})

describe('trackGoalAction: shape', () => {
	it('is a non-essential action of its own type', () => {
		const action = trackGoalAction()

		expect(action.type).toBe('analytics-goal')
		expect('essential' in action).toBe(false)
	})

	it('labels itself from the translation bundles', () => {
		expect(trackGoalAction().label).toEqual({
			en: 'Track analytics goal',
			de: 'Analytics-Ziel erfassen',
		})
	})

	it('authors a required goal picker plus value, valueFrom and currency', () => {
		const fields = trackGoalAction().config

		expect(fields.map((field) => ('name' in field ? field.name : ''))).toEqual([
			'goal',
			'value',
			'valueFrom',
			'currency',
		])

		const goal = fieldNamed(fields, 'goal') as TextField
		expect(goal.type).toBe('text')
		expect(goal.required).toBe(true)
		expect((goal.admin?.components?.Field as { path: string }).path).toBe(
			'@10x-media/analytics/client#GoalSelectField'
		)

		const value = fieldNamed(fields, 'value') as NumberField
		expect(value.type).toBe('number')
		expect(value.min).toBe(0)
		expect(value.required).toBeUndefined()
		expect(resolveLabel(value)).toBe(keys.goalFieldValue)

		const valueFrom = fieldNamed(fields, 'valueFrom') as TextField
		expect(valueFrom.type).toBe('text')
		expect(resolveLabel(valueFrom)).toBe(keys.actionGoalFieldValueFrom)

		const currency = fieldNamed(fields, 'currency') as TextField
		expect(currency.type).toBe('text')
		expect(resolveLabel(currency)).toBe(keys.goalFieldCurrency)
	})

	it('accepts a three-letter currency and refuses anything else', () => {
		const currency = fieldNamed(trackGoalAction().config, 'currency') as TextField
		const validate = currency.validate as TextFieldSingleValidation
		const options = {
			req: { t: (key: string) => key },
		} as unknown as Parameters<TextFieldSingleValidation>[1]

		expect(validate('EUR', options)).toBe(true)
		expect(validate('', options)).toBe(true)
		expect(validate(null, options)).toBe(true)
		expect(validate('eur', options)).toBe(keys.goalErrorCurrency)
		expect(validate('EURO', options)).toBe(keys.goalErrorCurrency)
	})

	it('is assignable to form-builder’s ActionDefinition', () => {
		expectTypeOf<GoalActionDefinition>().toExtend<ActionDefinition<Record<string, unknown>>>()

		const registered: ActionDefinition<Record<string, unknown>> = trackGoalAction()
		expect(registered.type).toBe('analytics-goal')
	})
})

describe('trackGoalAction: validateConfig', () => {
	const ctx = { data: {}, req: { t: (key: string) => key } } as unknown as Parameters<
		NonNullable<GoalActionDefinition['validateConfig']>
	>[1]

	it('accepts a configured goal', async () => {
		expect(await trackGoalAction().validateConfig?.({ goal: 'book-demo' }, ctx)).toBe(true)
	})

	it('refuses a missing or blank goal with a translated message', async () => {
		const validate = trackGoalAction().validateConfig
		expect(await validate?.({}, ctx)).toBe(keys.actionGoalErrorGoal)
		expect(await validate?.({ goal: '   ' }, ctx)).toBe(keys.actionGoalErrorGoal)
	})
})

describe('trackGoalAction: run', () => {
	it('tracks the configured goal on the form path with the submission props', async () => {
		await trackGoalAction({ hostname: 'shop.example' }).run(runArgs())

		expect(tracked).toHaveLength(1)
		expect(tracked[0]?.event).toEqual({
			type: 'goal',
			name: 'book-demo',
			path: '/forms/7',
			hostname: 'shop.example',
			value: undefined,
			currency: undefined,
			props: { formId: '7', formTitle: 'Demo request', submissionId: '42' },
		})
	})

	it('omits the form title when the form has none', async () => {
		await trackGoalAction({ hostname: 'shop.example' }).run(
			runArgs({ form: { id: 'abc' }, submissionId: 'xyz' })
		)

		expect(tracked[0]?.event.props).toEqual({ formId: 'abc', submissionId: 'xyz' })
		expect(tracked[0]?.event.path).toBe('/forms/abc')
	})

	it('forwards the submission request so scope and timezone resolve from it', async () => {
		const args = runArgs(withHost('shop.example'))
		await trackGoalAction().run(args)

		expect(tracked[0]?.opts).toEqual({ req: args.req })
	})

	it('throws when the goal is missing', async () => {
		await expect(
			trackGoalAction({ hostname: 'shop.example' }).run(runArgs({ config: {} }))
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(tracked).toHaveLength(0)
	})
})

describe('trackGoalAction: hostname', () => {
	it('takes a literal option', async () => {
		await trackGoalAction({ hostname: 'shop.example' }).run(runArgs())
		expect(tracked[0]?.event.hostname).toBe('shop.example')
	})

	it('takes a function of the run args', async () => {
		await trackGoalAction({
			hostname: (args) => `form-${args.form.id}.example`,
		}).run(runArgs())
		expect(tracked[0]?.event.hostname).toBe('form-7.example')
	})

	it('falls back to the request host with the port stripped', async () => {
		await trackGoalAction().run(runArgs(withHost('localhost:3000')))
		expect(tracked[0]?.event.hostname).toBe('localhost')
	})

	it('throws when there is no option and no request host', async () => {
		await expect(trackGoalAction().run(runArgs())).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(tracked).toHaveLength(0)
	})
})

describe('trackGoalAction: path', () => {
	it('defaults to the form path', async () => {
		await trackGoalAction({ hostname: 'shop.example' }).run(runArgs())
		expect(tracked[0]?.event.path).toBe('/forms/7')
	})

	it('takes a literal override', async () => {
		await trackGoalAction({ hostname: 'shop.example', path: '/thanks' }).run(runArgs())
		expect(tracked[0]?.event.path).toBe('/thanks')
	})

	it('takes a function of the run args', async () => {
		await trackGoalAction({
			hostname: 'shop.example',
			path: (args) => `/thanks/${args.submissionId}`,
		}).run(runArgs())
		expect(tracked[0]?.event.path).toBe('/thanks/42')
	})
})

describe('trackGoalAction: value', () => {
	const action = trackGoalAction({ hostname: 'shop.example' })

	it('takes the configured fixed value', async () => {
		await action.run(
			runArgs({
				config: { goal: 'purchase', value: 49, valueFrom: 'amount', currency: 'EUR' },
				values: [{ field: 'amount', value: 12 }],
			})
		)
		expect(tracked[0]?.event.value).toBe(49)
		expect(tracked[0]?.event.currency).toBe('EUR')
	})

	it('reads a finite submission answer when no fixed value is set', async () => {
		await action.run(
			runArgs({
				config: { goal: 'purchase', valueFrom: 'amount' },
				values: [
					{ field: 'other', value: 1 },
					{ field: 'amount', value: '120.50' },
				],
			})
		)
		expect(tracked[0]?.event.value).toBe(120.5)
	})

	it('leaves the value unset when the referenced answer is not numeric', async () => {
		await action.run(
			runArgs({
				config: { goal: 'purchase', valueFrom: 'amount' },
				values: [{ field: 'amount', value: 'a lot' }],
			})
		)
		expect(tracked[0]?.event.value).toBeUndefined()
	})

	it('leaves the value unset when the referenced answer is missing', async () => {
		await action.run(runArgs({ config: { goal: 'purchase', valueFrom: 'amount' } }))
		expect(tracked[0]?.event.value).toBeUndefined()
	})

	it('leaves the value unset when neither is configured', async () => {
		await action.run(runArgs({ config: { goal: 'purchase' } }))
		expect(tracked[0]?.event.value).toBeUndefined()
	})

	it('ignores a blank currency', async () => {
		await action.run(runArgs({ config: { goal: 'purchase', currency: '  ' } }))
		expect(tracked[0]?.event.currency).toBeUndefined()
	})
})
