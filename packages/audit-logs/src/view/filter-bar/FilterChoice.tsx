'use client'

import { ChevronIcon, Pill } from '@payloadcms/ui'

type Props = {
	active: boolean
	controls: string
	label: string
	onToggle: () => void
	open: boolean
	value: string
}

/**
 * One fixed filter: a pill that always carries its current value, "All" included,
 * and toggles its editor open below the bar, the way the list view toggles its
 * columns and filters. Fixed rather than added on demand, so the bar stays one row.
 */
export function FilterChoice({ active, controls, label, onToggle, open, value }: Props) {
	return (
		<Pill
			aria-controls={controls}
			aria-expanded={open}
			className={`al-choice${active ? ' al-choice--active' : ''}${open ? ' al-choice--open' : ''}`}
			icon={<ChevronIcon direction={open ? 'up' : 'down'} />}
			onClick={onToggle}
			pillStyle="light"
			size="small"
		>
			<span className="al-choice__label">{label}</span>
			{value && (
				<span className="al-choice__value" title={value}>
					{value}
				</span>
			)}
		</Pill>
	)
}
