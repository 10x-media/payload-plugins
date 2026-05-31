import { sharedVitestConfig } from '@10x-media/vitest-config/vitest.shared'
import { mergeConfig } from 'vitest/config'

export default mergeConfig(sharedVitestConfig, {
	test: {
		include: ['tests/**/*.test.ts'],
	},
})
