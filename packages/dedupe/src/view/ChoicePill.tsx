'use client'

import { Button, ChevronIcon, Popup, PopupList } from '@payloadcms/ui'

type Choice = { label: string; value: string }

/**
 * A trigger carrying the current value that opens the admin's own popover to change it, drawn
 * as the list view's Filters button (secondary, chevron, selected while open or narrowing the
 * list), so the queue adds no second kind of control. The popover is portalled, so nothing
 * around it can clip it.
 */
export const ChoicePill = ({
	groupLabel,
	onChange,
	options,
	value,
}: {
	groupLabel: string
	onChange: (value: string) => void
	options: Choice[]
	value: string
}) => {
	const selected = options.find((option) => option.value === value) ?? options[0]
	const narrowed = selected !== options[0]

	return (
		<Popup
			className="dedupe-choice"
			horizontalAlign="right"
			popupAriaLabel={groupLabel}
			render={({ close }) => (
				<PopupList.ButtonGroup>
					{options.map((option) => (
						<PopupList.Button
							active={option.value === value}
							key={option.value}
							onClick={() => {
								onChange(option.value)
								close()
							}}
						>
							{option.label}
						</PopupList.Button>
					))}
				</PopupList.ButtonGroup>
			)}
			renderButton={({ active: open, onClick, onKeyDown, ...aria }) => (
				<Button
					buttonStyle="secondary"
					className={['dedupe-choice__button', narrowed && 'dedupe-choice__button--active']
						.filter(Boolean)
						.join(' ')}
					extraButtonProps={{ ...aria, onKeyDown }}
					icon={<ChevronIcon direction={open ? 'up' : 'down'} size={16} />}
					margin={false}
					onClick={onClick}
					selected={open || narrowed}
					size="medium"
				>
					<span className="dedupe-choice__label">{groupLabel}</span>
					<span className="dedupe-choice__value" title={selected?.label}>
						{selected?.label ?? ''}
					</span>
				</Button>
			)}
			theme="auto"
			verticalAlign="bottom"
		/>
	)
}
