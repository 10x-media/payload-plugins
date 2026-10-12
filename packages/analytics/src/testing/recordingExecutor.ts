import type { SqlDialect } from '../native/store/dialect'
import type { DriverResult } from '../native/store/sql/drivers'
import type { SqlExecutor } from '../native/store/sql/executor'
import { compile, type SqlFragment } from '../native/store/sql/fragment'

/** A statement as {@link recordingExecutor} saw it: its text, whitespace collapsed, and values. */
export interface RecordedStatement {
	text: string
	values: unknown[]
}

/**
 * An executor recording each statement compiled for `dialect`. Each answers what `answer` returns
 * for its text, by default no rows and nothing written; tables are named by `table`.
 */
export const recordingExecutor = (
	dialect: SqlDialect,
	options: {
		table: SqlExecutor['table']
		answer?: ((text: string) => Partial<DriverResult>) | undefined
	}
): { executor: SqlExecutor; statements: RecordedStatement[] } => {
	const statements: RecordedStatement[] = []
	const run = async (fragment: SqlFragment): Promise<DriverResult> => {
		const { text, values } = compile(fragment, dialect)
		const flat = text.replace(/\s+/g, ' ').trim()
		statements.push({ text: flat, values })
		return { rows: [], rowCount: 0, ...options.answer?.(flat) }
	}
	const executor: SqlExecutor = {
		dialect,
		select: async (fragment) => (await run(fragment)).rows,
		execute: run,
		table: options.table,
		transaction: (work) => work(executor),
		batch: async (batched) => {
			const results: DriverResult[] = []
			for (const { statement } of batched) {
				results.push(await run(statement))
			}
			return { committed: true, results }
		},
		blocking: async () => false,
		close: async () => undefined,
	}
	return { executor, statements }
}
