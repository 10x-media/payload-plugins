import '@10x-media/form-builder/styles.css'
import type { ReactNode } from 'react'

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body style={{ fontFamily: 'system-ui, sans-serif' }}>{children}</body>
		</html>
	)
}
