'use client'

import { useContext, useMemo } from 'react'
import { serializeBody } from '../../actions/body/serializeBody'
import type { SubmissionValue } from '../../submissions/types'
import { defineFieldRenderer } from '../contract'
import { FormContext } from '../FormContext'

/**
 * Display-only renderer for a `message` field: serializes the authored `content` rich text to HTML
 * inline between fields. Recall tokens (`{{name}}`) resolve against the current answers (calc
 * values included). Never binds form state; the field writes nothing to submissions.
 */
export const messageRenderer = defineFieldRenderer(({ field }) => {
	const context = useContext(FormContext)
	const values = context?.effectiveValues ?? context?.state.values
	const html = useMemo(() => {
		const answered: SubmissionValue[] = Object.entries(values ?? {})
			.filter(([, value]) => value != null && value !== '')
			.map(([name, value]) => ({ field: name, value }))
		return serializeBody(field.content, { values: answered, descriptors: [] })
	}, [field.content, values])
	if (html === '') {
		return null
	}
	// Safe to inject: serializeBody HTML-escapes all text (recall values included) and sanitizes link URLs.
	// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by our escaping serializer, never raw user input
	return <div className="fb-field__message" dangerouslySetInnerHTML={{ __html: html }} />
})
