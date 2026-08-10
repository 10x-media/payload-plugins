'use client'

import { Pill, useConfig } from '@payloadcms/ui'

import { chipTargetKeys, describeTargets } from '../../shared/targetLabels'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './target-chips.css'

export type TargetChipsProps = {
	className?: string
	/** How many chips to show before collapsing the rest into a `+N`. */
	limit?: number
	/**
	 * The guide's target keys, e.g. `['collection:posts', 'block:hero']`. Field
	 * targets may be passed and are filtered out; see `chipTargetKeys`.
	 */
	targetKeys: string[] | undefined
}

/**
 * The surfaces a guide covers, as pills. This is what turns a list of guide
 * titles into something a reader can scan: "Publishing a post" says little,
 * "Publishing a post: Post, Hero" says where it applies.
 *
 * Collections, globals, and blocks carry their configured label. Field targets
 * are deliberately absent, because a guide covering a form attaches to enough of
 * them to drown out the entities beside them.
 */
export const TargetChips = ({ className, limit = 4, targetKeys }: TargetChipsProps) => {
	const { config } = useConfig()
	const { blockLabels } = useWikiTargets()
	const described = describeTargets(chipTargetKeys(targetKeys), {
		blockLabels,
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
