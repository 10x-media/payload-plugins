import { defineConfig } from 'vitest/config'

export const sharedVitestConfig = defineConfig({
	resolve: {
		conditions: ['development', 'import', 'module', 'default'],
	},
	test: {
		passWithNoTests: true,
		globals: false,
		pool: 'threads',
		isolate: true,
		testTimeout: 60_000,
		hookTimeout: 60_000,
		teardownTimeout: 30_000,
		sequence: { shuffle: false },
	},
})
