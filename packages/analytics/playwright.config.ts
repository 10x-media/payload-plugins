// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const mongoPort = process.env.MONGO_E2E_PORT ?? '37017'
const pgPort = process.env.PG_E2E_PORT ?? '35432'
const nextPort = process.env.E2E_NEXT_PORT ?? '3100'

const baseURL = `http://localhost:${nextPort}`

const tenancy = process.env.TENANCY === 'on' ? 'on' : 'off'
// One mongod/postgres serves both e2e.sh runs, so the two modes get their own database
// name to keep the off-mode and on-mode seeds from colliding.
const dbName = `analytics_e2e_${tenancy}`

// e2e.sh runs both tenancy modes back to back against different webServer env, so it
// forces this off; unset, a local one-off `playwright test` still reuses a running dev
// server the way the original config did.
const reuseExistingServer =
	process.env.E2E_REUSE_SERVER === '0'
		? false
		: process.env.E2E_REUSE_SERVER === '1'
			? true
			: !process.env.CI

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
		command: 'pnpm --filter @10x-media/analytics-dev start',
		cwd: path.resolve(dirname, '..', '..'),
		url: `${baseURL}/admin`,
		reuseExistingServer,
		timeout: 120_000,
		env: {
			PORT: nextPort,
			DEV_DB: process.env.DEV_DB ?? 'mongo',
			DATABASE_URI_MONGO: `mongodb://localhost:${mongoPort}/${dbName}?replicaSet=rs0&directConnection=true`,
			DATABASE_URI_POSTGRES: `postgres://e2e:e2e@localhost:${pgPort}/${dbName}`,
			// The providers collection's secret fields derive encryption keys from this when
			// no explicit `fields()` keys config is present (single-tenant mode); the fields
			// plugin requires at least 16 bytes of key material (32+ recommended).
			PAYLOAD_SECRET: 'e2e-secret-material-32-bytes-minimum!!',
			TENANCY: process.env.TENANCY ?? '',
		},
	},
})
