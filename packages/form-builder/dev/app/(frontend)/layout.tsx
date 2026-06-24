import '@10x-media/form-builder/styles.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Form builder demo' }

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body style={{ fontFamily: 'system-ui, sans-serif' }}>{children}</body>
		</html>
	)
}
