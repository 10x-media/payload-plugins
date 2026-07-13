/**
 * Workspace command router. Turns short positional commands into turbo or pnpm
 * invocations so users never type `--filter @10x-media/...`.
 *
 * Cacheable, dependency-aware tasks (build, lint, typecheck, test*) run through
 * turbo so they gain caching and dependency-aware ordering. Interactive or
 * side-effecting tasks (dev, start, generate*, migrate*, test:e2e, lint:fix) run
 * through pnpm filters.
 *
 * A target can be a plugin under `packages/` (e.g. automations) or an app
 * under `apps/` (e.g. docs). Plugins route their dev, start, gen, and migrate
 * tasks to a `-dev` companion package; apps have no companion and do not
 * support gen or migrate tasks.
 *
 * Examples:
 *   pnpm test                                 → turbo run test
 *   pnpm test automations                     → turbo run test --filter @10x-media/automations
 *   pnpm build docs                           → turbo run build --filter @10x-media/docs
 *   pnpm dev automations                      → pnpm --filter @10x-media/automations-dev run dev
 *   pnpm dev docs                             → pnpm --filter @10x-media/docs run dev
 *   pnpm migrate:create automations add-x     → pnpm --filter @10x-media/automations-dev run migrate:create add-x
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const APPS_DIR = join(REPO_ROOT, 'apps')
const SCOPE = '@10x-media'

const MIGRATE_TASKS = [
	'migrate',
	'migrate:create',
	'migrate:down',
	'migrate:refresh',
	'migrate:reset',
	'migrate:status',
	'migrate:fresh',
]
const DEV_PACKAGE_TASKS = new Set([
	'dev',
	'start',
	'generate',
	'generate:types',
	'generate:importmap',
	...MIGRATE_TASKS,
])
// Tasks that only make sense for plugins (they rely on the `-dev` companion app).
const PLUGIN_ONLY_TASKS = new Set([
	'generate',
	'generate:types',
	'generate:importmap',
	...MIGRATE_TASKS,
])
const REQUIRE_TARGET = new Set([
	'dev',
	'start',
	'generate',
	'generate:types',
	'generate:importmap',
	'test:e2e',
	...MIGRATE_TASKS,
])
const TURBO_TASKS = new Set([
	'build',
	'lint',
	'typecheck',
	'test',
	'test:unit',
	'test:int',
	'test:matrix',
	'test:container',
])

const dirNames = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name)
		: []

const knownPlugins = (): string[] => dirNames(PACKAGES_DIR)
const knownApps = (): string[] => dirNames(APPS_DIR)

const suggest = (typo: string, options: string[]): string | undefined => {
	const lower = typo.toLowerCase()
	return options.find((o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()))
}

const usage = (task: string, targets: string[]): never => {
	console.error(`Usage: pnpm ${task} <name> [extra args]`)
	console.error(`Available: ${targets.join(', ') || '(none)'}`)
	process.exit(2)
}

const run = (command: string, args: string[]): void => {
	const child = spawn(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	})
	child.on('error', (err) => {
		console.error(`Failed to run "${command}": ${err.message}`)
		process.exit(1)
	})
	child.on('exit', (code) => process.exit(code ?? 0))
}

const main = (): void => {
	const [task, maybeTarget, ...extraArgs] = process.argv.slice(2)

	if (!task) {
		console.error('Usage: tsx scripts/run.ts <task> [name] [extra args]')
		process.exit(2)
	}

	// Treat a leading-dash arg as a flag, not a target name.
	const isFlag = typeof maybeTarget === 'string' && maybeTarget.startsWith('-')
	const target = isFlag ? undefined : maybeTarget
	const passThrough = isFlag && maybeTarget ? [maybeTarget, ...extraArgs] : extraArgs
	const forwarded = passThrough.length > 0 ? ['--', ...passThrough] : []

	const plugins = knownPlugins()
	const apps = knownApps()
	const allTargets = [...plugins, ...apps]

	if (!target) {
		if (REQUIRE_TARGET.has(task)) usage(task, allTargets)

		if (TURBO_TASKS.has(task)) {
			run('pnpm', ['exec', 'turbo', 'run', task, ...forwarded])
			return
		}

		// Fan out across every workspace that defines the script.
		run('pnpm', ['-r', '--if-present', '--workspace-concurrency=4', 'run', task, ...passThrough])
		return
	}

	// Resolve target. Accept short names (automations, docs) or the full scope.
	const bare = target.startsWith(`${SCOPE}/`)
		? target.slice(SCOPE.length + 1).replace(/-dev$/, '')
		: target.replace(/-dev$/, '')

	const isPlugin = plugins.includes(bare)
	const isApp = apps.includes(bare)

	if (!isPlugin && !isApp) {
		const guess = suggest(bare, allTargets)
		console.error(`Unknown target: ${target}`)
		console.error(`Available: ${allTargets.join(', ') || '(none)'}`)
		if (guess) console.error(`Did you mean: ${guess}?`)
		process.exit(2)
	}

	if (isApp && PLUGIN_ONLY_TASKS.has(task)) {
		console.error(
			`Task "${task}" is not available for the ${bare} app (apps have no dev companion package).`
		)
		process.exit(2)
	}

	if (TURBO_TASKS.has(task)) {
		run('pnpm', ['exec', 'turbo', 'run', task, '--filter', `${SCOPE}/${bare}`, ...forwarded])
		return
	}

	// Plugins route dev/start/generate*/migrate* to their `-dev` companion; apps run on themselves.
	const useDevPackage = isPlugin && DEV_PACKAGE_TASKS.has(task)
	const filter = useDevPackage ? `${SCOPE}/${bare}-dev` : `${SCOPE}/${bare}`
	run('pnpm', ['--filter', filter, 'run', task, ...passThrough])
}

main()
