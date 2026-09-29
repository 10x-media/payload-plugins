import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { Screenshot } from './screenshot'
import { Video } from './video'

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Screenshot,
		Video,
		...components,
	} satisfies MDXComponents
}
