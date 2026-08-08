'use client'

import { Pill, useConfig } from '@payloadcms/ui'

import { describeTargets } from '../../shared/targetLabels'
import './target-chips.css'

export type TargetChipsProps = {
	className?: string
	/** How many chips to show before collapsing the rest into a `+N`. */
	limit?: number
	/** The guide's target keys, e.g. `['collection:posts', 'field:collection:posts.title']`. */
	targetKeys: string[] | undefined
}

/**
 * The surfaces a guide covers, as pills. This is what turns a list of guide
 * titles into something a reader can scan: "Publishing a post" says little,
 * "Publishing a post — Post, posts.title" says where it applies.
 *
 * Collection, global, and field chips carry their entity's configured label;
 * block slugs show verbatim, which is what the author typed.
 */
export const TargetChips = ({ className, limit = 4, targetKeys }: TargetChipsProps) => {
	const { config } = useConfig()
	const described = describeTargets(targetKeys ?? [], {
		collections: config.collections,
		globals: config.globals,
	})

	if (described.length === 0) {
		return null
	}

	const shown = described.slice(0, limit)
	const hidden = described.length - shown.length

	return (
		<span className={['wiki-target-chips', className].filter(Boolean).join(' ')}>
			{shown.map((target) => (
				<Pill
					className={`wiki-target-chips__chip wiki-target-chips__chip--${target.kind}`}
					key={`${target.kind}:${target.value}`}
					pillStyle="light-gray"
					size="small"
				>
					{target.label}
				</Pill>
			))}
			{hidden > 0 ? (
				<Pill className="wiki-target-chips__chip" pillStyle="light-gray" size="small">
					{`+${hidden}`}
				</Pill>
			) : null}
		</span>
	)
}
