'use client'

import { Button, ChevronIcon, Popup, PopupList } from '@payloadcms/ui'

export interface ChoiceMenuOption<T extends string> {
	value: T
	label: string
}

export interface ChoiceMenuProps<T extends string> {
	/** What the menu chooses ("Date range"): its popup's name, and read before the value. */
	label: string
	options: ReadonlyArray<ChoiceMenuOption<T>>
	value: T
	/** Called with a different option only; picking the current one just closes the menu. */
	onChange: (value: T) => void
	className?: string
}

/**
 * One choice as Payload's list controls and locale switcher make it: a button naming the current
 * option, opening a menu of the options with a check on the picked one. The button's name leads
 * with `label`, hidden, so a screen reader hears what is being chosen as well as the choice.
 */
export function ChoiceMenu<T extends string>({
	label,
	options,
	value,
	onChange,
	className,
}: ChoiceMenuProps<T>) {
	const current = options.find((option) => option.value === value)
	return (
		<Popup
			className={['analytics-choice', className].filter(Boolean).join(' ')}
			horizontalAlign="right"
			popupAriaLabel={label}
			popupType="menu"
			render={({ close }) => (
				<PopupList.RadioGroup>
					{options.map((option) => (
						<PopupList.RadioGroupItem
							active={option.value === value}
							key={option.value}
							onClick={() => {
								close()
								if (option.value !== value) {
									onChange(option.value)
								}
							}}
						>
							{option.label}
						</PopupList.RadioGroupItem>
					))}
				</PopupList.RadioGroup>
			)}
			renderButton={({ active, onClick, onKeyDown, ...ariaProps }) => (
				<Button
					buttonStyle="secondary"
					className="analytics-choice__trigger"
					extraButtonProps={{ onKeyDown }}
					icon={<ChevronIcon direction={active ? 'up' : 'down'} size={16} />}
					margin={false}
					onClick={onClick}
					selected={active}
					size="medium"
					{...ariaProps}
				>
					<span className="analytics-sr-only">{label} </span>
					{current?.label ?? value}
				</Button>
			)}
		/>
	)
}
