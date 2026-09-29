import { ImpersonationFrontendBanner } from '@10x-media/impersonation/rsc'
import type { Metadata } from 'next'
import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'
import type { ReactNode } from 'react'
import config from '../../payload.config'

export const metadata: Metadata = { title: 'Impersonation demo' }

export default async function FrontendLayout({ children }: { children: ReactNode }) {
	const payload = await getPayload({ config })
	const headers = new Headers(await nextHeaders())

	return (
		<html lang="en">
			<body
				style={{
					fontFamily: 'system-ui, sans-serif',
					lineHeight: 1.5,
					margin: 0,
					maxWidth: '40rem',
					padding: '2rem',
				}}
			>
				<ImpersonationFrontendBanner headers={headers} payload={payload} />
				{children}
			</body>
		</html>
	)
}
