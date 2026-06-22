'use client'

import { type FormDocument, Poll } from '@10x-media/form-builder/react'

export function DemoPoll({ form }: { form: unknown }) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Poll</h1>
			<Poll form={form as FormDocument} resultsField="framework" />
		</main>
	)
}
