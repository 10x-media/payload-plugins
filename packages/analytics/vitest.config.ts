import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { defineConfig, mergeConfig } from 'vitest/config'

// Cross-DB runs (DB_MATRIX set) forcibly SIGKILL their database, so the driver
// emits a benign teardown rejection after the tests have already passed. Ignore
// unhandled errors only then; the default `test` path and unit tests stay strict.
// biome-ignore lint/plugin/noProcessEnv: vitest config env boundary
const isMatrixRun = Boolean(process.env.DB_MATRIX)

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
						dangerouslyIgnoreUnhandledErrors: isMatrixRun,
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
