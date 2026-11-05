import type { Payload } from 'payload'
import { isRecord } from '../../src/core/values'
import type { SqlExecutor } from '../../src/native/store/sql/executor'
import { raw, type SqlFragment, sql } from '../../src/native/store/sql/fragment'

/**
 * The plan a statement runs with, as text: SQLite's query plan lines, or Postgres' JSON plan with
 * sequential scans off, so a table this small shows the index a big one would be read through.
 */
export const explainSql = async (
	executor: SqlExecutor,
	statement: SqlFragment
): Promise<string> => {
	if (executor.dialect.name === 'sqlite') {
		const rows = await executor.select(sql`EXPLAIN QUERY PLAN ${statement}`)
		return rows.map((row) => String(row.detail)).join('\n')
	}
	const rows = await executor.transaction(async (tx) => {
		await tx.execute(raw('SET LOCAL enable_seqscan = off'))
		return tx.select(sql`EXPLAIN (FORMAT JSON) ${statement}`)
	})
	return JSON.stringify(rows)
}

/** The executor's statements, each recorded as it is sent, so a test can explain them. */
export const recording = (
	executor: SqlExecutor
): { executor: SqlExecutor; selects: SqlFragment[] } => {
	const selects: SqlFragment[] = []
	return {
		selects,
		executor: {
			...executor,
			select: (statement, kind) => {
				selects.push(statement)
				return executor.select(statement, kind)
			},
		},
	}
}

interface Explainable {
	explain(verbosity?: string): Promise<unknown>
}

const isExplainable = (value: unknown): value is Explainable =>
	isRecord(value) && typeof value.explain === 'function'

/** The driver collection of one of the engine's collections, which plans can be asked of. */
const collectionOf = (payload: Payload, slug: string): Record<string, unknown> => {
	const models: unknown = Reflect.get(payload.db, 'collections')
	const model: unknown = isRecord(models) ? models[slug] : undefined
	const collection: unknown =
		typeof model === 'function' || isRecord(model) ? Reflect.get(model, 'collection') : undefined
	if (!isRecord(collection)) {
		throw new Error(`no driver collection for "${slug}"`)
	}
	return collection
}

/** MongoDB's plan of an aggregation, as text. */
export const explainPipeline = async (
	payload: Payload,
	slug: string,
	pipeline: object[]
): Promise<string> => {
	const collection = collectionOf(payload, slug)
	const aggregate = collection.aggregate
	const cursor: unknown =
		typeof aggregate === 'function' ? Reflect.apply(aggregate, collection, [pipeline, {}]) : null
	if (!isExplainable(cursor)) {
		throw new Error('the aggregation answered no cursor to explain')
	}
	return JSON.stringify(await cursor.explain('queryPlanner'))
}

/** MongoDB's plan of a find, as text. */
export const explainFind = async (
	payload: Payload,
	slug: string,
	query: { filter: object; sort?: object }
): Promise<string> => {
	const collection = collectionOf(payload, slug)
	const find = collection.find
	const options = query.sort === undefined ? {} : { sort: query.sort }
	const cursor: unknown =
		typeof find === 'function' ? Reflect.apply(find, collection, [query.filter, options]) : null
	if (!isExplainable(cursor)) {
		throw new Error('the find answered no cursor to explain')
	}
	return JSON.stringify(await cursor.explain('queryPlanner'))
}

/** The bounds the winning MongoDB plans read each index field over, by index name. */
export const indexBoundsOf = (plan: string): Array<{ index: string; bounds: unknown }> => {
	const found: Array<{ index: string; bounds: unknown }> = []
	const walk = (node: unknown, winning: boolean): void => {
		if (Array.isArray(node)) {
			for (const each of node) {
				walk(each, winning)
			}
			return
		}
		if (!isRecord(node)) {
			return
		}
		if (winning && typeof node.indexName === 'string' && node.indexBounds !== undefined) {
			found.push({ index: node.indexName, bounds: node.indexBounds })
		}
		for (const [key, value] of Object.entries(node)) {
			if (key !== 'rejectedPlans') {
				walk(value, winning || key === 'winningPlan')
			}
		}
	}
	walk(JSON.parse(plan), false)
	return found
}
