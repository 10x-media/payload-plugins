'use client'

import { Form, type ToFormDocumentOptions, toFormDocument } from '@10x-media/form-builder/react'

export function DemoForm({
	form,
	consentStatements,
}: {
	form: Parameters<typeof toFormDocument>[0]
	consentStatements?: ToFormDocumentOptions['consentStatements']
}) {
	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<Form form={toFormDocument(form, { consentStatements })} />
		</main>
	)
}
