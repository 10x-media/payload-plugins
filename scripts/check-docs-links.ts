/**
 * Checks every internal link of the docs content: each `](/path#anchor)` and `href="/path"`
 * outside fenced code must name a page that exists, an anchor that page has, or a file under
 * `apps/docs/public`. Anchors are slugged with the `github-slugger` fumadocs itself uses, and a
 * heading's `[#custom-id]` wins over its slug, as fumadocs reads it.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DOCS_APP = join(REPO_ROOT, 'apps/docs')
const CONTENT = join(DOCS_APP, 'content/docs')
const PUBLIC = join(DOCS_APP, 'public')

interface Slugger {
	slug(value: string): string
}

type SluggerClass = new () => Slugger

const isSluggerClass = (value: unknown): value is SluggerClass => typeof value === 'function'

/** The slugger fumadocs-core depends on, found through the docs app so the two never drift. */
const loadSlugger = async (): Promise<SluggerClass> => {
	const fumadocs = realpathSync(join(DOCS_APP, 'node_modules/fumadocs-core'))
	const resolved = createRequire(join(fumadocs, 'package.json')).resolve('github-slugger')
	const loaded: unknown = await import(pathToFileURL(resolved).href)
	const slugger: unknown =
		typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined
	if (!isSluggerClass(slugger)) {
		throw new Error(`github-slugger at ${resolved} exports no class`)
	}
	return slugger
}

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return walk(full)
		return name.endsWith('.mdx') ? [full] : []
	})

/** The URL a content file is served at: a folder's `index.mdx` at the folder's own. */
const urlOf = (file: string): string => {
	const parts = relative(CONTENT, file)
		.replace(/\.mdx$/, '')
		.split('/')
	if (parts.at(-1) === 'index') parts.pop()
	return `/${parts.join('/')}`.replace(/\/$/, '') || '/'
}

/** Body lines outside fenced code, numbered as in the file, with the frontmatter cut. */
const bodyLines = (text: string): Array<{ line: string; number: number }> => {
	const lines = text.split('\n')
	const out: Array<{ line: string; number: number }> = []
	let start = 0
	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1)
		start = end === -1 ? 0 : end + 1
	}
	let fence: string | null = null
	for (let index = start; index < lines.length; index++) {
		const line = lines[index] ?? ''
		const open = line.match(/^\s*(`{3,}|~{3,})/)
		if (open) {
			if (fence === null) fence = open[1] ?? null
			else if (line.trim().startsWith(fence)) fence = null
			continue
		}
		if (fence === null) out.push({ line, number: index + 1 })
	}
	return out
}

/**
 * A heading's text as fumadocs slugs it: no custom id, link targets, emphasis or tags, while a code
 * span keeps its text whole, `<Poll>` included.
 */
const plainHeading = (text: string): string =>
	text
		.replace(/\s*\[#[^\]]+\]\s*$/, '')
		.split('`')
		.map((part, index) =>
			index % 2 === 1
				? part
				: part
						.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
						.replace(/\*\*([^*]+)\*\*/g, '$1')
						.replace(/\*([^*]+)\*/g, '$1')
						.replace(/<[^>]+>/g, '')
		)
		.join('')
		.trim()

/** Where a link leads from the page at `url`: a relative one resolves as the browser resolves it. */
const pathOf = (target: string, url: string): string => {
	const [path = ''] = target.split('#')
	if (path === '') return url
	const absolute = path.startsWith('/')
		? path
		: new URL(path, `https://docs.invalid${url}`).pathname
	return absolute.replace(/\/$/, '') || '/'
}

export interface LinkReport {
	pages: number
	checked: number
	broken: string[]
}

export const checkDocsLinks = async (): Promise<LinkReport> => {
	const Slugger = await loadSlugger()
	const pages = new Map<string, { anchors: Set<string>; text: string }>()
	for (const file of walk(CONTENT)) {
		const slugger = new Slugger()
		const anchors = new Set<string>()
		const text = readFileSync(file, 'utf8')
		for (const { line } of bodyLines(text)) {
			const heading = line.match(/^#{1,6}\s+(.*)$/)?.[1]
			if (heading === undefined) continue
			const custom = heading.match(/\[#([^\]]+)\]\s*$/)?.[1]
			anchors.add(custom ?? slugger.slug(plainHeading(heading)))
		}
		pages.set(urlOf(file), { anchors, text })
	}

	const broken: string[] = []
	let checked = 0
	for (const [url, page] of pages) {
		for (const { line, number } of bodyLines(page.text)) {
			const scrubbed = line.replace(/`[^`]*`/g, '')
			const targets = [
				...[...scrubbed.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ''),
				...[...scrubbed.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? ''),
			]
			for (const target of targets) {
				if (/^(https?:|mailto:)/.test(target)) continue
				checked += 1
				const hash = target.split('#')[1]
				const resolved = pathOf(target, url)
				if (resolved.startsWith('/images/') || /\.\w+$/.test(resolved)) {
					if (!existsSync(join(PUBLIC, resolved)))
						broken.push(`${url}:${number} ${target} (no file)`)
					continue
				}
				const linked = pages.get(resolved)
				if (!linked) {
					broken.push(`${url}:${number} ${target} (no page)`)
				} else if (hash && !linked.anchors.has(hash)) {
					broken.push(`${url}:${number} ${target} (no anchor)`)
				}
			}
		}
	}
	return { pages: pages.size, checked, broken }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const report = await checkDocsLinks()
	for (const line of report.broken) console.error(`  ${line}`)
	console.log(
		`links: ${report.checked} checked on ${report.pages} pages, ${report.broken.length} broken`
	)
	process.exitCode = report.broken.length > 0 ? 1 : 0
}
