import './globals.css'
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Support (website demo)' }

/** shadcn's theme reads the font from `--font-sans`. */
const sans = Geist({ subsets: ['latin'], variable: '--font-sans' })

export default function FrontendLayout({ children }: { children: ReactNode }) {
	return (
		<html className={sans.variable} lang="en">
			<body className="min-h-screen antialiased">{children}</body>
		</html>
	)
}
