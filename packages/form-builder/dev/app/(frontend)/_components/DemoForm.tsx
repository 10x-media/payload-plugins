'use client'

import { Form, toFormDocument } from '@10x-media/form-builder/react'

export function DemoForm({ form }: { form: Parameters<typeof toFormDocument>[0] }) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<Form form={toFormDocument(form)} />
		</main>
	)
}
