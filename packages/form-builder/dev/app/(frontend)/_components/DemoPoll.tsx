'use client'

import { Poll, toFormDocument } from '@10x-media/form-builder/react'

export function DemoPoll({ form }: { form: Parameters<typeof toFormDocument>[0] }) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Poll</h1>
			<Poll form={toFormDocument(form)} resultsField="framework" />
		</main>
	)
}
