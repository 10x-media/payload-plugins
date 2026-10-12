import type { Payload } from 'payload'
import { isRecord } from '../../core/values'
import { dbKind } from '../../db/kind'
import { STATE_SLUG } from '../collections/slugs'
import { isMongoStateModel, type MongoStateModel, mongoStateStore } from './mongo/mongoState'
import { createSqlExecutor, type SqlExecutor } from './sql/executor'
import { sqlStateStore } from './sql/sqlState'
import type { StateStore, StateStoreOptions } from './types'

/**
 * `payload.db.collections[slug]`: the model Payload's Mongo adapter compiled for a collection,
 * refused unless `isModel` accepts it.
 */
export const mongoModelOf = <M>(
	payload: Payload,
	slug: string,
	isModel: (value: unknown) => value is M
): M => {
	const models: unknown = Reflect.get(payload.db, 'collections')
	const model = isRecord(models) ? models[slug] : undefined
	if (!isModel(model)) {
		throw new Error(`analytics: the database has no model for the "${slug}" collection`)
	}
	return model
}

/** The model Payload's Mongo adapter compiled for state rows. */
export const stateModelOf = (payload: Payload, slug: string = STATE_SLUG): MongoStateModel =>
	mongoModelOf(payload, slug, isMongoStateModel)

/** The state store for the database a Payload instance runs on, on `executor` when one is given. */
export const createStateStore = (
	payload: Payload,
	options: StateStoreOptions & { executor?: SqlExecutor } = {}
): StateStore => {
	if (dbKind(payload) !== 'mongo') {
		return sqlStateStore(options.executor ?? createSqlExecutor(payload), options)
	}
	// Found now, so a missing model fails the build, and per call, as a dev reload replaces them.
	stateModelOf(payload, options.slug)
	return mongoStateStore(() => stateModelOf(payload, options.slug), options)
}
