'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { useMemo } from 'react'

import { collectGuideHeadings } from '../../shared/headings'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './guide-article.css'

export type { WikiBlockRenderer } from '../WikiProvider/WikiProvider'

export type GuideArticleProps = {
	className?: string
	data: SerializedEditorState
}

/**
 * The single read renderer for guide content, shared by hover-card escalation
 * drawers, surface guide drawers, and the wiki view.
 */
export const GuideArticle = ({ className, data }: GuideArticleProps) => {
	const { guideConverters } = useWikiTargets()
	const { idsByNode } = useMemo(() => collectGuideHeadings(data), [data])
	const composed = useMemo(() => guideConverters(idsByNode), [guideConverters, idsByNode])

	return (
		<div className={['wiki-guide-article', className].filter(Boolean).join(' ')}>
			<RichText converters={composed} data={data} disableContainer />
		</div>
	)
}
