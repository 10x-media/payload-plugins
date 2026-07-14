'use client'

import {
	defineFieldRenderer,
	type SubmissionValue,
	serializeBody,
	useFormState,
} from '@10x-media/form-builder/react'
import { useMemo } from 'react'

/** Display-only rich text rendered inline between fields; writes nothing to the submission. */
export const messageField = defineFieldRenderer(({ field }) => {
	const { values } = useFormState()
	const html = useMemo(() => {
		const answered: SubmissionValue[] = Object.entries(values)
			.filter(([, value]) => value != null && value !== '')
			.map(([name, value]) => ({ field: name, value }))
		return serializeBody(field.content, { values: answered, descriptors: [] })
	}, [field.content, values])
	if (html === '') {
		return null
	}
	// Safe to inject: serializeBody HTML-escapes all text (recall values included) and sanitizes link URLs.
	return (
		<div
			className="prose prose-sm max-w-none text-foreground"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by the package's escaping serializer, never raw user input
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
})
