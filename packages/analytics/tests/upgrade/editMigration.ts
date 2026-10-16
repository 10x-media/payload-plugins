import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Applies the hand edits of upgrading/beta-12.mdx to a generated migration. Each edit throws when
 * its statement is missing, so a migration drifting from the page fails the test.
 */

type Dialect = 'postgres' | 'sqlite' | 'mongo'

interface EditOptions {
	/**
	 * Whether Payload's jobs table already exists (a task was registered before), so the page's
	 * DELETE of retired runs applies; otherwise the migration creates the table, without the DELETE.
	 */
	priorTasks: boolean
	/** A scoped install's tenants, each given an enabled `native` provider document. */
	nativeTenants: string[]
}

const OLD_TABLES = ['analytics_events', 'analytics_rollups', 'analytics_seen'] as const

// Compared as text: the task enum of an install that registered only some of its tasks (sync
// alone, say) has no label for the others, and Postgres refuses a literal of an absent label.
const RETIRED_RUNS_POSTGRES =
	'DELETE FROM "payload_jobs" WHERE "task_slug"::text IN (\'analytics-prune-events\', \'analytics-warm-cache\');'

const RETIRED_RUNS_SQLITE =
	"DELETE FROM payload_jobs WHERE task_slug IN ('analytics-prune-events', 'analytics-warm-cache');"

class MigrationDrift extends Error {}

const drift = (step: string, detail: string): never => {
	throw new MigrationDrift(`upgrading/beta-12.mdx, ${step}: ${detail}`)
}

const occurrences = (source: string, needle: string): number => source.split(needle).length - 1

/** The body of `up` and the source around it, so edits never touch `down`. */
const splitUp = (source: string): { before: string; up: string; after: string } => {
	const start = source.indexOf('export async function up(')
	const down = source.indexOf('export async function down(')
	if (start === -1 || down === -1) {
		return drift('the generated file', 'has no up and down functions')
	}
	const close = source.lastIndexOf('}', down)
	return {
		before: source.slice(0, start),
		up: source.slice(start, close),
		after: source.slice(close),
	}
}

const withUp = (source: string, edit: (up: string) => string): string => {
	const { before, up, after } = splitUp(source)
	return `${before}${edit(up)}${after}`
}

/** `deleteLegacySalts` at the end of `up`, as the page's closing paragraph shows. */
const deleteSalts = (source: string): string =>
	`import { deleteLegacySalts } from '@10x-media/analytics/migrations'\n${withUp(
		source,
		(up) => `${up}  await deleteLegacySalts({ payload })\n`
	)}`

/**
 * One enabled `native` provider per tenant at the end of `up`, in the migration's `req`, as a
 * user `access.crossScope` admits, since the providers collection stamps every write's scope.
 */
const nativePerTenant = (source: string, tenants: string[]): string => {
	if (tenants.length === 0) {
		return source
	}
	return withUp(source, (up) => {
		if (!/export async function up\(\{[^}]*\breq\b[^}]*\}/.test(up)) {
			drift('scoped installs', 'up receives no req to run its writes in')
		}
		if (!/export async function up\(\{[^}]*\bpayload\b[^}]*\}/.test(up)) {
			drift('scoped installs', 'up receives no payload')
		}
		return `${up}  const [platform] = (await payload.find({ collection: 'users', limit: 1, req })).docs
  for (const scope of ${JSON.stringify(tenants)}) {
    await payload.create({
      collection: 'analytics-providers',
      data: { name: 'Payload', provider: 'native', enabled: true, scope },
      req,
      user: platform,
    })
  }
`
	})
}

const editPostgres = (source: string, edits: EditOptions): string =>
	deleteSalts(
		withUp(source, (up) => {
			let edited = up
			for (const table of OLD_TABLES) {
				const constraint = `DROP CONSTRAINT "payload_locked_documents_rels_${table}_fk";`
				if (occurrences(edited, constraint) !== 1) {
					drift('Postgres step 1', `no single "${constraint}" in up`)
				}
				edited = edited.replace(
					constraint,
					`DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_${table}_fk";`
				)
			}
			const opening = 'await db.execute(sql`'
			if (!edited.includes(opening)) {
				drift('Postgres steps 2 and 3', 'up runs no db.execute to edit')
			}
			if (edits.priorTasks) {
				edited = edited.replace(opening, `${opening}\n  ${RETIRED_RUNS_POSTGRES}`)
			}
			const addValue =
				/ALTER TYPE "public"\."enum_analytics_providers_provider" ADD VALUE 'native' BEFORE 'plausible';\n?/
			if (!addValue.test(edited)) {
				drift('Postgres step 3', "no ADD VALUE 'native' on enum_analytics_providers_provider")
			}
			edited = edited.replace(addValue, '')
			return edited.replace(
				opening,
				'await (payload.db as unknown as PostgresAdapter).drizzle.execute(\n    sql`ALTER TYPE "public"."enum_analytics_providers_provider" ADD VALUE IF NOT EXISTS \'native\' BEFORE \'plausible\';`\n  )\n  ' +
					opening
			)
		})
	).replace(
		/import \{([^}]*)\} from '@payloadcms\/db-postgres'/,
		(_, names: string) =>
			`import {${names.trimEnd()}, type PostgresAdapter } from '@payloadcms/db-postgres'`
	)

/** One `await db.run(...)` statement of the generated SQLite file, by what its SQL says. */
const runLine = (up: string, matches: (line: string) => boolean): string | undefined =>
	up.split('\n').find((line) => line.trim().startsWith('await db.run(') && matches(line))

const editSqlite = (source: string, edits: EditOptions): string =>
	deleteSalts(
		withUp(source, (up) => {
			let edited = up
			const drops = OLD_TABLES.map((table) => {
				const line = runLine(edited, (each) => each.includes(`DROP TABLE \\\`${table}\\\`;`))
				return line ?? drift('SQLite step 1', `no DROP TABLE of ${table} in up`)
			})
			for (const line of drops) {
				edited = edited.replace(`${line}\n`, '')
			}
			const lines = edited.split('\n')
			const rebuilt = lines.findLastIndex(
				(line) =>
					line.includes('CREATE INDEX') && line.includes('ON \\`payload_locked_documents_rels\\`')
			)
			if (rebuilt === -1) {
				drift('SQLite step 1', 'up does not rebuild payload_locked_documents_rels')
			}
			lines.splice(rebuilt + 1, 0, ...drops)
			edited = lines.join('\n')

			const insert = runLine(edited, (line) =>
				line.includes('INSERT INTO \\`__new_analytics_providers\\`')
			)
			if (!insert) {
				return drift('SQLite step 2', 'up does not rebuild analytics_providers')
			}
			let trimmed = insert
			for (const column of ['"ga4_currency"', '"posthog_scope_property"']) {
				if (occurrences(trimmed, `, ${column}`) !== 2) {
					drift('SQLite step 2', `${column} is not in both column lists of the rebuild`)
				}
				trimmed = trimmed.replaceAll(`, ${column}`, '')
			}
			// Columns later releases added, which the old table never had: 1.0.0-beta.13's
			// `is_default` (scoped installs only) and 1.0.0-beta.15's `without_consent`.
			for (const column of ['"is_default"', '"without_consent"']) {
				trimmed = trimmed.replaceAll(`, ${column}`, '')
			}
			edited = edited.replace(insert, trimmed)
			return edits.priorTasks ? `${edited}  await db.run(sql\`${RETIRED_RUNS_SQLITE}\`)\n` : edited
		})
	)

export const editUpgradeMigration = (
	source: string,
	dialect: Dialect,
	edits: EditOptions
): string => {
	if (dialect === 'mongo') {
		return nativePerTenant(source, edits.nativeTenants)
	}
	const edited = dialect === 'postgres' ? editPostgres(source, edits) : editSqlite(source, edits)
	return nativePerTenant(edited, edits.nativeTenants)
}

const flagValue = (flags: string[], name: string): string | undefined => {
	const at = flags.indexOf(name)
	return at === -1 ? undefined : flags[at + 1]
}

const [file, dialect, ...flags] = process.argv.slice(2)
if (file && (dialect === 'postgres' || dialect === 'sqlite' || dialect === 'mongo')) {
	const edits = {
		priorTasks: !flags.includes('--no-prior-tasks'),
		nativeTenants: (flagValue(flags, '--native-tenants') ?? '').split(',').filter(Boolean),
	}
	try {
		writeFileSync(file, editUpgradeMigration(readFileSync(file, 'utf8'), dialect, edits))
		console.log(`upgrade: applied the upgrading page's ${dialect} edits to ${file}`)
	} catch (err) {
		console.error(err instanceof MigrationDrift ? err.message : err)
		process.exit(1)
	}
}
