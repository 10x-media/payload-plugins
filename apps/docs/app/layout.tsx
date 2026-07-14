import './global.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://docs.10xmedia.de'),
	title: {
		default: '10x-media Payload plugins',
		template: '%s | 10x-media plugins',
	},
	description: 'Open-source plugins for Payload v3, published under the @10x-media scope.',
}

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<RootProvider search={{ options: { type: 'static' } }}>{children}</RootProvider>
			</body>
		</html>
	)
}
