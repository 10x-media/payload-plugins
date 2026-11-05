import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Impersonation demo' }

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body style={{ margin: 0 }}>{children}</body>
		</html>
	)
}
