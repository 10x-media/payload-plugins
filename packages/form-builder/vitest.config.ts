import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { defineConfig, mergeConfig } from 'vitest/config'

// biome-ignore lint/plugin/noProcessEnv: vitest config env boundary
const isMatrixRun = Boolean(process.env.DB_MATRIX)

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
