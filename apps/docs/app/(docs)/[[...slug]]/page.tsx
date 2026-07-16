import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { slugsToMarkdownPath, source } from '@/lib/source'

const githubDocsBase =
	'https://github.com/10x-media/payload-plugins/blob/main/apps/docs/content/docs'

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug?: string[] }>
}): Promise<Metadata> {
	const { slug } = await params
	const page = source.getPage(slug)
	if (!page) notFound()
	return { title: page.data.title, description: page.data.description }
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
	const { slug } = await params
	const page = source.getPage(slug)
	if (!page) notFound()

	const MDX = page.data.body
	const markdownUrl = `/llms.mdx/${slugsToMarkdownPath(page.slugs).join('/')}`

	return (
		<DocsPage toc={page.data.toc} full={page.data.full}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription className="mb-0">{page.data.description}</DocsDescription>
			<div className="flex flex-row items-center gap-2 border-b pt-2 pb-6">
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover
					markdownUrl={markdownUrl}
					githubUrl={`${githubDocsBase}/${page.path}`}
				/>
			</div>
			<DocsBody>
				<MDX components={getMDXComponents()} />
			</DocsBody>
		</DocsPage>
	)
}

export function generateStaticParams() {
	return source.generateParams()
}
