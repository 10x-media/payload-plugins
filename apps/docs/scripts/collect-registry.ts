import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves every plugin's shadcn registry from the static docs site: copies
 * `packages/<slug>/registry/r/*.json` (built by the plugin's `registry:build`,
 * committed, drift-checked by `pnpm check:registry`) into `public/r/<slug>/`.
 * Each plugin is a registry of its own, so items are addressed as
 * `https://docs.10xmedia.de/r/<slug>/<item>.json` and never collide; the
 * folder's `registry.json` is its index. Runs before `dev` and `build`.
 */
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packages = path.resolve(docs, '../../packages')
const target = path.join(docs, 'public/r')

rmSync(target, { force: true, recursive: true })
const collected: string[] = []
for (const slug of readdirSync(packages)) {
	const registry = path.join(packages, slug, 'registry')
	const built = path.join(registry, 'r')
	if (!existsSync(built)) continue
	const out = path.join(target, slug)
	mkdirSync(out, { recursive: true })
	cpSync(built, out, { recursive: true })
	// Older shadcn CLIs write no index; the source file is a valid one.
	if (!existsSync(path.join(out, 'registry.json'))) {
		cpSync(path.join(registry, 'registry.json'), path.join(out, 'registry.json'))
	}
	collected.push(slug)
}
console.log(`registry: ${collected.join(', ') || 'none'} -> public/r`)
