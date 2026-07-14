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
						exclude: ['node_modules', 'dist', '.next', 'tests/e2e/**', 'registry/**'],
						dangerouslyIgnoreUnhandledErrors: isMatrixRun,
					},
				},
				{
					extends: true,
					test: {
						name: 'jsdom',
						environment: 'jsdom',
						include: ['src/**/*.test.tsx'],
						exclude: ['node_modules', 'dist', '.next', 'registry/**'],
						setupFiles: ['./vitest.setup.ts'],
					},
				},
				{
					extends: true,
					test: {
						name: 'registry',
						environment: 'jsdom',
						include: ['registry/**/*.test.tsx', 'registry/**/*.test.ts'],
						setupFiles: ['./vitest.setup.ts'],
						passWithNoTests: true,
					},
					resolve: {
						alias: {
							'@/lib/utils': new URL('./registry/__shims__/utils.ts', import.meta.url).pathname,
							'@/components/ui/input': new URL('./registry/__shims__/ui.tsx', import.meta.url)
								.pathname,
							'@/components/ui/textarea': new URL('./registry/__shims__/ui.tsx', import.meta.url)
								.pathname,
							'@/components/ui/label': new URL('./registry/__shims__/ui.tsx', import.meta.url)
								.pathname,
							'@/components/ui': new URL('./registry/__shims__/ui.tsx', import.meta.url).pathname,
						},
					},
				},
			],
		},
	})
)
