'use client'

import type { AnchorHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { TEXT_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { useFileContent } from './useFileContent'
import { WithFileContent } from './ViewerStatus'

const REMARK_PLUGINS = [remarkGfm]

/** Links in an uploaded file leave the admin in a new tab, never in place. */
const ExternalLink = ({ children, href }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
	<a href={href} rel="noopener noreferrer" target="_blank">
		{children}
	</a>
)

const COMPONENTS = { a: ExternalLink }

/**
 * Markdown rendered as it reads, with GitHub-flavored tables, task lists and
 * strikethrough. Raw HTML in the file is not rendered (react-markdown's
 * default), and `javascript:` links are stripped, so an uploaded file cannot
 * run script in the admin.
 */
export const MarkdownViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'text',
		maxBytes: TEXT_MAX_BYTES,
		url: props.url,
	})
	return (
		<WithFileContent file={props} state={state}>
			{(text) => (
				<div className="document-preview-markdown">
					<article className="document-preview-markdown__article">
						<ReactMarkdown components={COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
							{text}
						</ReactMarkdown>
					</article>
				</div>
			)}
		</WithFileContent>
	)
}
