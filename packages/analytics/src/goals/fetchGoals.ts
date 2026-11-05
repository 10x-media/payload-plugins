import { isRecord } from '../core/values'
import { requestShaped } from '../ui/data/request'
import { createSharedCache } from '../ui/data/sharedCache'
import type { GoalSource } from './resolver'

/**
 * One goal as the goals endpoint lists it.
 *
 * @beta
 */
export interface WireGoal {
	slug: string
	name: string
	source: GoalSource
}

/**
 * The goals endpoint's answer.
 *
 * @beta
 */
export interface GoalsResponse {
	goals: WireGoal[]
	/** The goals collection, when the install enabled it, so a picker can link to it. */
	collection: { slug: string } | null
}

const isWireGoal = (value: unknown): value is WireGoal =>
	isRecord(value) &&
	typeof value.slug === 'string' &&
	typeof value.name === 'string' &&
	(value.source === 'config' || value.source === 'collection' || value.source === 'builtin')

const isGoalsResponse = (value: unknown): value is GoalsResponse =>
	isRecord(value) &&
	Array.isArray(value.goals) &&
	value.goals.every(isWireGoal) &&
	(value.collection === null ||
		(isRecord(value.collection) && typeof value.collection.slug === 'string'))

const cache = createSharedCache<GoalsResponse>()

/**
 * The goal list at `url` for one request scope, read once and shared by every picker on the page. A
 * refusal or malformed answer rejects and drops the entry, so a later mount retries.
 */
export const fetchGoals = (url: string, scope: string): Promise<GoalsResponse> =>
	cache.read({ route: url, scope }, () => requestShaped(url, isGoalsResponse))
