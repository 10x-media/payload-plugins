import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { ReactNode } from 'react'
import { Wordmark } from '@/components/wordmark'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			nav={{
				title: (
					<span className="flex items-baseline gap-2 leading-none">
						<Wordmark className="h-4 w-auto" />
						<span className="font-medium text-fd-muted-foreground">Plugins</span>
					</span>
				),
			}}
			githubUrl="https://github.com/10x-media/payload-plugins"
		>
			{children}
		</DocsLayout>
	)
}
