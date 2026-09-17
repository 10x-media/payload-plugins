import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Impersonation demo' }

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body
				style={{
					fontFamily: 'system-ui, sans-serif',
					lineHeight: 1.5,
					margin: 0,
					padding: '2rem',
					maxWidth: '40rem',
				}}
			>
				{children}
			</body>
		</html>
	)
}
