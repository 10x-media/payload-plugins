'use client'

import { Form, type FormDocument } from '@10x-media/form-builder/react'

export function DemoForm({ form }: { form: unknown }) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<Form form={form as FormDocument} />
		</main>
	)
}
