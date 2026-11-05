import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { defineConfig, mergeConfig } from 'vitest/config'

// biome-ignore lint/plugin/noProcessEnv: vitest config env boundary
const dbMatrix = process.env.DB_MATRIX ?? ''
const matrixDbs = dbMatrix.split(',').map((db) => db.trim())
const sqliteLane = matrixDbs.includes('sqlite')

// Mongo and Postgres lanes kill their database at teardown, so the driver emits a benign
// rejection after the tests passed; only there are unhandled errors ignored. SQLite has no
// server to kill, so its lanes stay as strict as the default `test` path and the unit tests.
const ignoreTeardownRejections = Boolean(dbMatrix) && !sqliteLane

// One Postgres server serves the whole run, and every worker boots Payload against it. A
// many-core machine otherwise opens enough connections at once to push that server into
// recovery mode, which fails specs that changed nothing.
const POSTGRES_MAX_WORKERS = 4

// Every Mongo boot starts an in-memory replica set of its own, so a many-core machine otherwise
// runs one mongod per core at once.
const MONGO_MAX_WORKERS = 3

const workerCaps = [
	...(matrixDbs.includes('postgres') ? [POSTGRES_MAX_WORKERS] : []),
	...(matrixDbs.includes('mongo') ? [MONGO_MAX_WORKERS] : []),
]

/** Browser-only modules; everything else runs in the node project. */
const JSDOM_TESTS = ['src/tracker/**/*.test.ts', 'src/**/*.test.tsx']

// Test selection is controlled by package.json scripts that pass explicit
// paths. Default `test` runs everything below; `test:unit`/`test:int`/
// `test:matrix` narrow the include glob. Unit tests are co-located with their
// source (`src/**/*.test.ts`); int and e2e tests live under `tests/`.
export default mergeConfig(
	sharedVitestConfig,
	defineConfig({
		test: {
			setupFiles: ['./tests/setup/clock.ts'],
			projects: [
				{
					extends: true,
					test: {
						name: 'node',
						environment: 'node',
						// One Postgres server for the whole run instead of one per Payload boot;
						// a no-op unless DB_MATRIX asks for Postgres. Scoped to this project
						// because a root globalSetup is loaded and run once per project.
						globalSetup: ['./tests/setup/sharedPostgres.ts'],
						setupFiles: ['./tests/setup/release.ts'],
						dangerouslyIgnoreUnhandledErrors: ignoreTeardownRejections,
						...(workerCaps.length > 0 ? { maxWorkers: Math.min(...workerCaps) } : {}),
						// Vitest ends a worker thread with `terminate()`, and libsql's native code aborts the
						// whole run (SIGABRT) when that lands mid-statement; a forked worker is killed by a
						// signal instead, which ends that worker alone.
						...(sqliteLane ? { pool: 'forks' } : {}),
						include: ['tests/int/**/*.int.spec.ts', 'src/**/*.test.ts'],
						exclude: ['node_modules', 'dist', '.next', 'tests/e2e/**', ...JSDOM_TESTS],
						// The admin view's server shell pulls in Payload's own admin chrome, whose
						// dist imports stylesheets. Externalized, Node's loader chokes on the first
						// `.css`; inlined, vite transforms them away.
						server: { deps: { inline: [/@payloadcms\/next/, /@payloadcms\/ui/] } },
					},
				},
				{
					extends: true,
					test: {
						name: 'jsdom',
						environment: 'jsdom',
						// The vendor snippets are scripts: proving one self-sequences means letting
						// jsdom actually run it. No test loads a remote resource (`resources` stays
						// off), so only plugin-authored inline code ever executes.
						environmentOptions: { jsdom: { runScripts: 'dangerously' } },
						include: JSDOM_TESTS,
						exclude: ['node_modules', 'dist', '.next'],
					},
				},
			],
		},
	})
)
