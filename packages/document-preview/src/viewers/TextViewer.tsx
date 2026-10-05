'use client'

import { CodeEditorLazy } from '@payloadcms/ui'
import { useMemo } from 'react'

import { codeLanguage } from '../shared/codeLanguage'
import { TEXT_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { useFileContent } from './useFileContent'
import { WithFileContent } from './ViewerStatus'

/** JSON is re-indented for reading; anything that does not parse is shown as is. */
const formatText = (text: string, language: string): string => {
	if (language !== 'json') {
		return text
	}
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}

const EDITOR_OPTIONS = {
	domReadOnly: true,
	lineNumbers: 'on',
	padding: { bottom: 12, top: 12 },
	renderLineHighlight: 'none',
} as const

const TextContent = ({ language, text }: { language: string; text: string }) => {
	const value = useMemo(() => formatText(text, language), [language, text])
	return (
		<div className="document-preview-code">
			<CodeEditorLazy
				defaultLanguage={language}
				height="100%"
				options={EDITOR_OPTIONS}
				readOnly
				value={value}
			/>
		</div>
	)
}

/**
 * Plain text, JSON, XML, YAML and code in Payload's own code editor (Monaco, the
 * one behind JSON fields), read-only: highlighting, line numbers, folding and
 * search. The editor fills the preview and scrolls inside it.
 */
export const TextViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'text',
		maxBytes: TEXT_MAX_BYTES,
		url: props.url,
	})
	const language = codeLanguage(props.filename, props.mimeType)
	return (
		<WithFileContent file={props} state={state}>
			{(text) => <TextContent language={language} text={text} />}
		</WithFileContent>
	)
}
