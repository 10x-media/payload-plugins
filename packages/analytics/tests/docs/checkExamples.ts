/**
 * Type-checks every `ts`/`tsx` block of the analytics docs. A `.ts` block is a fragment whose bare
 * names get imports supplied; a `.tsx` block is a whole file; fence meta `partial` skips a block.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = join(HERE, '..', '..')
const DOCS = join(PACKAGE, '..', '..', 'apps/docs/content/docs/analytics')
const STUBS = join(HERE, 'stubs')
/** Where the blocks live as modules, so they resolve the package's own dependencies. Never written. */
const EXAMPLES = join(HERE, '.examples')

/** The folder of `name`'s entry as Node resolves it from `from`, wherever the installer put it. */
const entryDirOf = (from: string, name: string): string =>
	dirname(createRequire(from).resolve(name))

// Neither is a dependency of this package: lexical comes from the test harness, which boots
// Payload with it, and the multi-tenant plugin from the dev app.
const HARNESS = createRequire(join(PACKAGE, 'package.json')).resolve(
	'@10x-media/payload-test-harness'
)
const LEXICAL = entryDirOf(HARNESS, '@payloadcms/richtext-lexical')
const MULTI_TENANT = entryDirOf(
	join(PACKAGE, 'dev/package.json'),
	'@payloadcms/plugin-multi-tenant'
)

/** Each entry's report, in the order a bare name is looked up: the first entry exporting it wins. */
const ENTRY_ORDER: ReadonlyArray<[report: string, specifier: string]> = [
	['index', '@10x-media/analytics'],
	['adapters-native', '@10x-media/analytics/adapters/native'],
	['adapters-plausible', '@10x-media/analytics/adapters/plausible'],
	['adapters-umami', '@10x-media/analytics/adapters/umami'],
	['adapters-ga4', '@10x-media/analytics/adapters/ga4'],
	['adapters-posthog', '@10x-media/analytics/adapters/posthog'],
	['i18n', '@10x-media/analytics/i18n'],
	['geo', '@10x-media/analytics/geo'],
	['next', '@10x-media/analytics/next'],
	['migrations', '@10x-media/analytics/migrations'],
	['testing', '@10x-media/analytics/testing'],
]

/** Names a fragment may use bare that the package does not export. */
const SUPPLIED: Readonly<Record<string, string>> = {
	buildConfig: "import { buildConfig } from 'payload'",
	getPayload: "import { getPayload } from 'payload'",
	CollectionConfig: "import type { CollectionConfig } from 'payload'",
	Block: "import type { Block } from 'payload'",
	Field: "import type { Field } from 'payload'",
	PayloadRequest: "import type { PayloadRequest } from 'payload'",
	Payload: "import type { Payload } from 'payload'",
	TypedUser: "import type { TypedUser } from 'payload'",
	mongooseAdapter: "import { mongooseAdapter } from '@payloadcms/db-mongodb'",
	sqliteAdapter: "import { sqliteAdapter } from '@payloadcms/db-sqlite'",
	config: "import config from '@payload-config'",
	payload: "declare const payload: import('payload').Payload",
	req: "declare const req: import('payload').PayloadRequest",
}

/** Diagnostics for a name that is not in scope, which a supplied import may fix. */
const MISSING_NAME = new Set([2304, 2552, 2582, 2503])

interface Block {
	lang: string
	meta: string
	/** The page line the code starts on. */
	start: number
	code: string
}

interface Example {
	page: string
	start: number
	code: string
	ext: 'ts' | 'tsx'
	prelude: string[]
}

export interface ExamplesReport {
	checked: number
	partial: number
	problems: string[]
}

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return walk(full)
		return name.endsWith('.mdx') ? [full] : []
	})

/** Every fenced block of one page, its code dedented by the fence's own indent. */
const blocksOf = (text: string): Block[] => {
	const blocks: Block[] = []
	let open: (Block & { indent: number; fence: string; body: string[] }) | null = null
	for (const [index, line] of text.split('\n').entries()) {
		if (open === null) {
			const fence = line.match(/^(\s*)(`{3,})(\S*)\s*(.*)$/)
			if (fence) {
				const [, indent = '', marks = '', lang = '', meta = ''] = fence
				open = {
					indent: indent.length,
					fence: marks,
					lang,
					meta,
					start: index + 2,
					code: '',
					body: [],
				}
			}
			continue
		}
		if (line.trim() === open.fence) {
			blocks.push({
				lang: open.lang,
				meta: open.meta,
				start: open.start,
				code: open.body.join('\n'),
			})
			open = null
			continue
		}
		const leading = line.length - line.trimStart().length
		open.body.push(line.slice(Math.min(open.indent, leading)))
	}
	return blocks
}

/** The names a report exports, each marked when it is a type alone. */
const exportsOf = (report: string): Map<string, boolean> => {
	const text = readFileSync(join(PACKAGE, 'api', `${report}.api.md`), 'utf8')
	const names = new Map<string, boolean>()
	for (const match of text.matchAll(
		/^export (?:declare )?(?:abstract )?(class|interface|type|const|function|enum) ([\w$]+)/gm
	)) {
		const [, kind = '', name = ''] = match
		names.set(name, kind === 'interface' || kind === 'type')
	}
	for (const match of text.matchAll(/^export \{ ([\w$]+)(?: as ([\w$]+))? \}/gm)) {
		const [, name = '', alias] = match
		names.set(alias ?? name, true)
	}
	return names
}

const suppliedImports = (): Map<string, string> => {
	const lines = new Map<string, string>()
	for (const [report, specifier] of ENTRY_ORDER) {
		for (const [name, typeOnly] of exportsOf(report)) {
			if (!lines.has(name)) {
				lines.set(name, `import ${typeOnly ? 'type ' : ''}{ ${name} } from '${specifier}'`)
			}
		}
	}
	for (const [name, line] of Object.entries(SUPPLIED)) lines.set(name, line)
	return lines
}

const OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.Preserve,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
	strict: true,
	noUncheckedIndexedAccess: true,
	isolatedModules: true,
	esModuleInterop: true,
	resolveJsonModule: true,
	skipLibCheck: true,
	jsx: ts.JsxEmit.ReactJSX,
	noEmit: true,
	types: ['node'],
	typeRoots: [join(PACKAGE, 'node_modules/@types')],
	customConditions: ['development'],
	paths: {
		'@payload-config': [join(STUBS, 'payload-config.ts')],
		'@/components/AnalyticsGate': [join(STUBS, 'analytics-gate.tsx')],
		'@payloadcms/plugin-multi-tenant': [join(MULTI_TENANT, 'index.d.ts')],
		'@payloadcms/plugin-multi-tenant/utilities': [join(MULTI_TENANT, 'exports/utilities.d.ts')],
		'@payloadcms/richtext-lexical': [join(LEXICAL, 'index.d.ts')],
		'@payloadcms/richtext-lexical/react': [join(LEXICAL, 'exports/react/index.d.ts')],
	},
}

/** A host serving the examples from memory and everything else from disk. */
const hostFor = (examples: ReadonlyMap<string, Example>): ts.CompilerHost => {
	const host = ts.createCompilerHost(OPTIONS, true)
	const sourceOf = (example: Example): string => {
		const prelude = example.prelude.length > 0 ? `${example.prelude.join('\n')}\n` : ''
		const body = `${prelude}${example.code}\n`
		return /^\s*(import|export)\s/m.test(body) ? body : `${body}\nexport {}\n`
	}
	const getSourceFile = host.getSourceFile.bind(host)
	const fileExists = host.fileExists.bind(host)
	const readFile = host.readFile.bind(host)
	host.getSourceFile = (...args: Parameters<ts.CompilerHost['getSourceFile']>) => {
		const [fileName, languageVersion] = args
		const example = examples.get(fileName)
		return example
			? ts.createSourceFile(fileName, sourceOf(example), languageVersion, true)
			: getSourceFile(...args)
	}
	host.fileExists = (fileName) => examples.has(fileName) || fileExists(fileName)
	host.readFile = (fileName) => {
		const example = examples.get(fileName)
		return example ? sourceOf(example) : readFile(fileName)
	}
	return host
}

const diagnosticsOf = (
	examples: ReadonlyMap<string, Example>,
	oldProgram?: ts.Program
): { program: ts.Program; byFile: Map<string, ts.Diagnostic[]> } => {
	const program = ts.createProgram({
		rootNames: [...examples.keys(), join(STUBS, 'modules.d.ts')],
		options: OPTIONS,
		host: hostFor(examples),
		...(oldProgram ? { oldProgram } : {}),
	})
	const byFile = new Map<string, ts.Diagnostic[]>()
	for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
		const name = diagnostic.file?.fileName ?? ''
		const key = examples.has(name) ? name : '(other)'
		byFile.set(key, [...(byFile.get(key) ?? []), diagnostic])
	}
	return { program, byFile }
}

const message = (diagnostic: ts.Diagnostic): string =>
	ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')

export const checkDocsExamples = (options: { list?: boolean } = {}): ExamplesReport => {
	const examples = new Map<string, Example>()
	let partial = 0
	for (const page of walk(DOCS)) {
		const rel = relative(DOCS, page)
		for (const [index, block] of blocksOf(readFileSync(page, 'utf8')).entries()) {
			if (!['ts', 'tsx', 'typescript'].includes(block.lang)) continue
			if (/(^|\s)partial(\s|$)/.test(block.meta)) {
				partial += 1
				if (options.list) console.log(`skip ${rel}:${block.start}`)
				continue
			}
			const ext = block.lang === 'tsx' ? 'tsx' : 'ts'
			const name = `${rel.replace(/\.mdx$/, '').replaceAll('/', '__')}__${String(index).padStart(2, '0')}.${ext}`
			examples.set(join(EXAMPLES, name), {
				page: rel,
				start: block.start,
				code: block.code,
				ext,
				prelude: [],
			})
		}
	}

	let { program, byFile } = diagnosticsOf(examples)
	const supplied = suppliedImports()
	let added = 0
	for (const [file, diagnostics] of byFile) {
		const example = examples.get(file)
		if (example?.ext !== 'ts') continue
		for (const diagnostic of diagnostics) {
			if (!MISSING_NAME.has(diagnostic.code)) continue
			const name = message(diagnostic).match(/name '([\w$]+)'/)?.[1]
			const line = name ? supplied.get(name) : undefined
			if (line && !example.prelude.includes(line)) {
				example.prelude.push(line)
				added += 1
			}
		}
	}
	if (added > 0) {
		;({ program, byFile } = diagnosticsOf(examples, program))
	}

	const problems: string[] = []
	for (const diagnostic of byFile.get('(other)') ?? []) {
		problems.push(
			`${diagnostic.file?.fileName ?? 'program'}: TS${diagnostic.code} ${message(diagnostic)}`
		)
	}
	for (const [file, example] of examples) {
		const source = ts.createSourceFile(
			file,
			`${example.code}\n`,
			ts.ScriptTarget.Latest,
			true,
			example.ext === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
		)
		const fragments = source.statements.filter((statement) => ts.isLabeledStatement(statement))
		for (const fragment of fragments) {
			const { line } = source.getLineAndCharacterOfPosition(fragment.getStart())
			problems.push(
				`${example.page}:${example.start + line} an object literal's member rather than a statement: complete it or mark the block partial`
			)
		}
		const diagnostics = byFile.get(file) ?? []
		for (const diagnostic of diagnostics) {
			const { line } = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0) ?? {
				line: 0,
			}
			const pageLine = example.start + line - example.prelude.length
			problems.push(`${example.page}:${pageLine} TS${diagnostic.code} ${message(diagnostic)}`)
		}
		if (options.list && diagnostics.length === 0 && fragments.length === 0) {
			const note = example.prelude.length > 0 ? ` (${example.prelude.length} supplied)` : ''
			console.log(`ok   ${example.page}:${example.start}${note}`)
		}
	}
	return { checked: examples.size, partial, problems }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const report = checkDocsExamples({ list: process.argv.includes('--list') })
	for (const problem of report.problems) console.error(`  ${problem}`)
	console.log(
		`examples: ${report.checked} blocks checked, ${report.partial} marked partial, ${report.problems.length} problems`
	)
	process.exitCode = report.problems.length > 0 ? 1 : 0
}
