// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const mongoPort = process.env.MONGO_E2E_PORT ?? '37017'
const pgPort = process.env.PG_E2E_PORT ?? '35432'
const nextPort = process.env.E2E_NEXT_PORT ?? '3100'
// e2e.sh makes a folder per run for the SQLite files; unset, the dev app keeps its own file.
const sqliteDir = process.env.E2E_SQLITE_DIR

const baseURL = `http://localhost:${nextPort}`

// A vendor profile boots the dev app's single-site vendor mode against the mock upstream the
// global setup starts (tests/e2e/vendors), so it shares the single-site database.
const vendorProfile = process.env.ANALYTICS_E2E_VENDORS ?? ''
const upstreamPort = process.env.E2E_UPSTREAM_PORT ?? String(Number(nextPort) + 1000)
process.env.E2E_UPSTREAM_PORT = upstreamPort

const tenancy = process.env.TENANCY === 'on' && !vendorProfile ? 'on' : 'off'
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
	// On CI the HTML report beside the annotations, which the e2e job uploads when a leg fails.
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
		actionTimeout: 15_000,
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	...(vendorProfile ? { globalSetup: './tests/e2e/vendors/globalSetup.ts' } : {}),
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
			...(sqliteDir ? { DATABASE_URI_SQLITE: `file:${path.join(sqliteDir, `${dbName}.db`)}` } : {}),
			// The providers collection's secret fields derive encryption keys from this when
			// no explicit `fields()` keys config is present (single-tenant mode); the fields
			// plugin requires at least 16 bytes of key material (32+ recommended).
			PAYLOAD_SECRET: 'e2e-secret-material-32-bytes-minimum!!',
			TENANCY: tenancy,
			// Playwright's browser reports navigator.webdriver, which capture.skip leaves uncounted.
			ANALYTICS_COUNT_AUTOMATION: '1',
			ANALYTICS_SLOW_SOURCE_MS: process.env.ANALYTICS_SLOW_SOURCE_MS ?? '',
			ANALYTICS_E2E_VENDORS: vendorProfile,
			...(vendorProfile ? { ANALYTICS_E2E_UPSTREAM: `http://127.0.0.1:${upstreamPort}` } : {}),
		},
	},
})
