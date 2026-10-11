import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * The load suite, run on demand with `pnpm test:load` and never by `test`, `test:int` or turbo.
 * One file at a time on one worker, so its numbers are not shared with another spec's work.
 */
export default mergeConfig(
	sharedVitestConfig,
	defineConfig({
		test: {
			name: 'load',
			environment: 'node',
			include: ['tests/load/**/*.load.ts'],
			fileParallelism: false,
			maxWorkers: 1,
			// Under an AI agent vitest defaults to its minimal reporter, which silences the console of
			// passing tests and with it the results table this suite prints.
			reporters: ['default'],
			testTimeout: 60 * 60_000,
			hookTimeout: 10 * 60_000,
			server: { deps: { inline: [/@payloadcms\/next/, /@payloadcms\/ui/] } },
		},
	})
)
