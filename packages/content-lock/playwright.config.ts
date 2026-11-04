// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const mongoPort = process.env.MONGO_E2E_PORT ?? '37017'
const pgPort = process.env.PG_E2E_PORT ?? '35432'
/** The app's port. The name predates the TanStack Start leg, which uses it as well. */
const appPort = process.env.E2E_NEXT_PORT ?? '3100'

/**
 * `E2E_FRAMEWORK=tanstack` runs the suite on the TanStack Start dev app's production build, served
 * by `srvx`; anything else on the Next dev app's, served by `next start`. `scripts/e2e.sh` builds
 * whichever one it is.
 */
const tanstack = process.env.E2E_FRAMEWORK === 'tanstack'

const baseURL = `http://localhost:${appPort}`

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.e2e.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
		actionTimeout: 15_000,
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: tanstack
			? 'pnpm --filter @10x-media/content-lock-dev-tanstack start'
			: 'pnpm --filter @10x-media/content-lock-dev start',
		cwd: path.resolve(dirname, '..', '..'),
		url: `${baseURL}/admin`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			PORT: appPort,
			DEV_DB: process.env.DEV_DB ?? 'mongo',
			DATABASE_URI_MONGO: `mongodb://localhost:${mongoPort}/content-lock_e2e?replicaSet=rs0&directConnection=true`,
			DATABASE_URI_POSTGRES: `postgres://e2e:e2e@localhost:${pgPort}/content-lock_e2e`,
			PAYLOAD_SECRET: 'e2e-secret-material-32-bytes-minimum!!',
		},
	},
})
