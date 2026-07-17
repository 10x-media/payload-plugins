import type { ReactNode } from 'react'

export default function AppLayout({ children }: { children: ReactNode }) {
	return (
		// Canvas/CanvasText follow the declared color-scheme, so the demo stays legible
		// in a dark-mode browser without a media query.
		<html lang="en" style={{ colorScheme: 'light dark' }}>
			<body
				style={{
					background: 'Canvas',
					color: 'CanvasText',
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
