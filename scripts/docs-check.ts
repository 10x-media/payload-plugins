/**
 * `pnpm docs:check`: the docs' internal links (every page) and the analytics docs' code examples,
 * type-checked against the package's source. Both run, and either failing fails the check.
 * `--links-only` skips the examples: the v4 line uses it until analytics is ported to Payload 4.
 */

import { checkDocsExamples } from '../packages/analytics/tests/docs/checkExamples'
import { checkDocsLinks } from './check-docs-links'

const timed = async <T>(run: () => T | Promise<T>): Promise<{ value: T; seconds: string }> => {
	const started = performance.now()
	const value = await run()
	return { value, seconds: ((performance.now() - started) / 1000).toFixed(1) }
}

const links = await timed(checkDocsLinks)
for (const line of links.value.broken) console.error(`  ${line}`)
console.log(
	`links: ${links.value.checked} checked on ${links.value.pages} pages, ${links.value.broken.length} broken (${links.seconds}s)`
)

const linksOnly = process.argv.includes('--links-only')
const examples = linksOnly ? null : await timed(() => checkDocsExamples())
if (examples) {
	for (const problem of examples.value.problems) console.error(`  ${problem}`)
	console.log(
		`analytics examples: ${examples.value.checked} blocks checked, ${examples.value.partial} marked partial, ${examples.value.problems.length} problems (${examples.seconds}s)`
	)
} else {
	console.log('analytics examples: skipped (--links-only)')
}

if (links.value.broken.length > 0 || (examples?.value.problems.length ?? 0) > 0) {
	console.error(
		'\nFix the page, or mark a block that is deliberately incomplete as partial: ```ts partial'
	)
	process.exit(1)
}
