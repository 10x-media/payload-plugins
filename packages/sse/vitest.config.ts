import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { defineConfig, mergeConfig } from 'vitest/config'

// Cross-DB runs (DB_MATRIX set) forcibly SIGKILL their database, so the driver
// emits a benign teardown rejection after the tests have already passed. Ignore
// unhandled errors only then; the default `test` path and unit tests stay strict.
// biome-ignore lint/plugin/noProcessEnv: vitest config env boundary
const isMatrixRun = Boolean(process.env.DB_MATRIX)

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
						include: ['tests/int/**/*.int.spec.ts', 'src/**/*.test.ts'],
						exclude: ['node_modules', 'dist', '.next', 'tests/e2e/**'],
						dangerouslyIgnoreUnhandledErrors: isMatrixRun,
					},
				},
				{
					extends: true,
					test: {
						name: 'jsdom',
						environment: 'jsdom',
						include: ['src/**/*.test.tsx'],
						exclude: ['node_modules', 'dist', '.next'],
						setupFiles: ['./vitest.setup.ts'],
					},
				},
			],
		},
	}),
)
