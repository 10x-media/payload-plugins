import type { ReactNode } from 'react'

export default function AppLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body
				style={{
					fontFamily: 'system-ui, sans-serif',
					margin: '0 auto',
					maxWidth: '40rem',
					padding: '3rem 1.5rem',
					lineHeight: 1.6,
				}}
			>
				{children}
			</body>
		</html>
	)
}
