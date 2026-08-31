import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'SSE playground' }

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
		</html>
	)
}
