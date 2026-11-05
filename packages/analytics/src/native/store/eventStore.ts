import type { Payload } from 'payload'
import { hasMethods, isRecord } from '../../core/values'
import { dbKind } from '../../db/kind'
import {
	AGGREGATES_SLUG,
	DEFAULT_STORE_SLUGS,
	HITS_SLUG,
	type StoreSlugs,
} from '../collections/slugs'
import {
	isMongoAggregatesModel,
	isMongoHitsModel,
	type MongoAggregatesModel,
	type MongoHitsModel,
	type MongoStoreModels,
	type MongoStoreOptions,
	mongoEventStore,
} from './mongo/mongoStore'
import { createSqlExecutor, type SqlExecutor, type SqlExecutorOptions } from './sql/executor'
import { sqlEventStore } from './sql/sqlStore'
import { mongoModelOf, stateModelOf } from './stateStore'
import type { EventStore } from './types'

/** The model Payload's Mongo adapter compiled for the hits. */
export const hitsModelOf = (payload: Payload, slug: string = HITS_SLUG): MongoHitsModel =>
	mongoModelOf(payload, slug, isMongoHitsModel)

const aggregatesModelOf = (
	payload: Payload,
	slug: string = AGGREGATES_SLUG
): MongoAggregatesModel => mongoModelOf(payload, slug, isMongoAggregatesModel)

interface CommandDb {
	command(command: object): Promise<unknown>
}

const isCommandDb = (value: unknown): value is CommandDb => hasMethods(value, ['command'])

/** The version a MongoDB server reports (`buildInfo`); null when it has none or cannot be asked. */
const mongoServerVersion = async (payload: Payload): Promise<string | null> => {
	const connection: unknown = Reflect.get(payload.db, 'connection')
	const db: unknown = isRecord(connection) ? connection.db : undefined
	if (!isCommandDb(db)) {
		return null
	}
	const info = await db.command({ buildInfo: 1 })
	const version = isRecord(info) ? info.version : undefined
	return typeof version === 'string' ? version : null
}

/**
 * The SQL executor's options and the Mongo store's; the clock and the hooks serve both stores. An
 * `executor` already built runs the SQL instead of a new one, so stores can share its threads.
 */
export type EventStoreOptions = SqlExecutorOptions &
	MongoStoreOptions & {
		executor?: SqlExecutor
		slugs?: StoreSlugs
	}

/** The hit store for the database a Payload instance runs on. */
export const createEventStore = (payload: Payload, options: EventStoreOptions = {}): EventStore => {
	const slugs = options.slugs ?? DEFAULT_STORE_SLUGS
	if (dbKind(payload) !== 'mongo') {
		return sqlEventStore(options.executor ?? createSqlExecutor(payload, options), {
			...options,
			slugs,
		})
	}
	const models = (): MongoStoreModels => ({
		hits: hitsModelOf(payload, slugs.hits),
		aggregates: aggregatesModelOf(payload, slugs.aggregates),
		state: stateModelOf(payload, slugs.state),
	})
	// Found now, so a missing model fails the build, and per call, as a dev reload replaces them.
	models()
	return mongoEventStore(models, {
		serverVersion: () => mongoServerVersion(payload),
		warn: (message) => payload.logger?.error(message),
		...options,
	})
}
