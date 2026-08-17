import { BlockquoteFeature } from '@payloadcms/richtext-lexical'
import { QUOTE } from '@payloadcms/richtext-lexical/lexical/markdown'

/**
 * Payload's `BlockquoteFeature` with Lexical's own `QUOTE` markdown transformer
 * in place of the one it ships. Everything else stays Payload's: the node, the
 * toolbar entry, the HTML converter, the translations, and the key it registers
 * under.
 *
 * A markdown blockquote is one quote per `> ` line, and the importer folds each
 * continuation line into the quote before it. Payload's transformer splices the
 * line's children straight on, so `> one\n> two` imports as the single text run
 * `onetwo`: two words, no space and no break between them. Lexical's `QUOTE`
 * prepends a line break to that same splice, which is the whole difference.
 *
 * Seeding is where it shows: GitHub alerts (`> [!NOTE]`) are written as
 * multi-line blockquotes and become the plugin's callout blocks, so without
 * this every multi-line callout arrives with its lines glued together.
 */
export const WikiBlockquoteFeature = (): ReturnType<typeof BlockquoteFeature> => {
	const provider = BlockquoteFeature()
	const { feature } = provider
	const withQuoteTransformer = <Feature extends object>(resolved: Feature): Feature => ({
		...resolved,
		markdownTransformers: [QUOTE],
	})
	return {
		...provider,
		feature:
			typeof feature === 'function'
				? async (...args: Parameters<typeof feature>) =>
						withQuoteTransformer(await feature(...args))
				: withQuoteTransformer(feature),
	} as ReturnType<typeof BlockquoteFeature>
}
