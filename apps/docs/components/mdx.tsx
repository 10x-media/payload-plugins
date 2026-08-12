import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { Video } from './video'

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Video,
		...components,
	} satisfies MDXComponents
}
