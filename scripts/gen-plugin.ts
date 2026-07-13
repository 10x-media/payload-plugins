import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const TEMPLATE_ROOT = join(REPO_ROOT, 'tooling', 'plugin-template', 'template')

const toCamel = (slug: string): string =>
	slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

const toPascal = (slug: string): string => {
	const camel = toCamel(slug)
	return camel.charAt(0).toUpperCase() + camel.slice(1)
}

const toTitle = (slug: string): string =>
	slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')

interface PluginVars {
	pluginSlug: string
	pluginCamel: string
	pluginPascal: string
	pluginTitle: string
	pluginDescription: string
	packageName: string
}

const collectFiles = async (dir: string, out: string[] = []): Promise<string[]> => {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) await collectFiles(full, out)
		else out.push(full)
	}
	return out
}

const applyVars = (content: string, vars: PluginVars): string =>
	content
		.replaceAll('{{packageName}}', vars.packageName)
		.replaceAll('{{pluginSlug}}', vars.pluginSlug)
		.replaceAll('{{pluginCamel}}', vars.pluginCamel)
		.replaceAll('{{pluginPascal}}', vars.pluginPascal)
		.replaceAll('{{pluginTitle}}', vars.pluginTitle)
		.replaceAll('{{pluginDescription}}', vars.pluginDescription)

/**
 * Normalize the generated package to Biome's canonical form. The template
 * substitutes values of varying length into lines whose wrapping then depends on
 * the slug, so no single committed template can satisfy the formatter for every
 * slug. Formatting the output here keeps every scaffold lint-clean regardless of
 * slug length. Mirrors the repo's `lint:fix` (`biome check --write src tests dev`),
 * so it also applies Biome's safe assists; any unresolved (non-formatting) error
 * aborts generation rather than shipping a broken scaffold.
 */
const formatGenerated = (slug: string): void => {
	const targets = ['src', 'tests', 'dev'].map((dir) => join('packages', slug, dir))
	try {
		execFileSync('pnpm', ['exec', 'biome', 'check', '--write', ...targets], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		})
	} catch (err) {
		throw new Error(
			`Biome found unresolved issues in generated packages/${slug} (see output above). Fix the template, then regenerate.`,
			{ cause: err }
		)
	}
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/

interface ParsedArgs {
	slug?: string
	description?: string
}

const parseArgs = (argv: string[]): ParsedArgs => {
	const out: ParsedArgs = {}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === '--slug') out.slug = argv[++i]
		else if (arg.startsWith('--slug=')) out.slug = arg.slice('--slug='.length)
		else if (arg === '--description') out.description = argv[++i]
		else if (arg.startsWith('--description=')) out.description = arg.slice('--description='.length)
	}
	return out
}

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2))
	const interactive = process.stdin.isTTY === true

	p.intro('Scaffold a new Payload plugin')

	let slug: string
	if (args.slug !== undefined) {
		if (!SLUG_RE.test(args.slug)) {
			p.cancel(`Invalid slug "${args.slug}". Use kebab-case, start with a letter.`)
			process.exit(1)
		}
		slug = args.slug
	} else if (interactive) {
		const answer = await p.text({
			message: 'Plugin slug (kebab-case, no @scope)',
			placeholder: 'awesome-thing',
			validate: (v) => (SLUG_RE.test(v) ? undefined : 'Use kebab-case, start with a letter.'),
		})
		if (p.isCancel(answer)) process.exit(0)
		slug = answer
	} else {
		p.cancel('Missing --slug. Pass --slug <kebab-case> in non-interactive mode.')
		process.exit(1)
	}

	let description: string
	if (args.description !== undefined) {
		description = args.description
	} else if (interactive) {
		const answer = await p.text({
			message: 'Short description',
			placeholder: 'Does the awesome thing for Payload',
		})
		if (p.isCancel(answer)) process.exit(0)
		description = answer
	} else {
		description = ''
	}

	const vars: PluginVars = {
		pluginSlug: slug,
		pluginCamel: toCamel(slug),
		pluginPascal: toPascal(slug),
		pluginTitle: toTitle(slug),
		pluginDescription: description,
		packageName: `@10x-media/${slug}`,
	}

	const destRoot = join(REPO_ROOT, 'packages', slug)
	const files = await collectFiles(TEMPLATE_ROOT)

	for (const src of files) {
		const rel = relative(TEMPLATE_ROOT, src).replace(/\.tmpl$/, '')
		const dest = join(destRoot, rel)
		const raw = await readFile(src, 'utf8')
		const out = src.endsWith('.tmpl') ? applyVars(raw, vars) : raw
		await mkdir(dirname(dest), { recursive: true })
		await writeFile(dest, out)
	}

	formatGenerated(slug)

	p.outro(`Created packages/${slug}. Run \`pnpm install\` then \`pnpm test ${slug}\`.`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
