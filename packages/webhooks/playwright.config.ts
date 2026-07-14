// biome-ignore-all lint/plugin/noProcessEnv: e2e config env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.e2e.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:3100',
		trace: 'on-first-retry',
		actionTimeout: 15_000,
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm --filter @10x-media/webhooks-dev start',
		cwd: path.resolve(dirname, '..', '..'),
		url: 'http://localhost:3100/admin',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			PORT: '3100',
			DEV_DB: process.env.DEV_DB ?? 'mongo',
			DATABASE_URI_MONGO:
				'mongodb://localhost:37017/webhooks_e2e?replicaSet=rs0&directConnection=true',
			DATABASE_URI_POSTGRES: 'postgres://e2e:e2e@localhost:35432/webhooks_e2e',
			PAYLOAD_SECRET: 'e2e-secret',
		},
	},
})
