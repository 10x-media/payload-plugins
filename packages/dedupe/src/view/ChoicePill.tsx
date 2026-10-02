'use client'

import { ChevronIcon, Pill, Popup, PopupList } from '@payloadcms/ui'

type Choice = { label: string; value: string }

/**
 * A pill carrying the current value that opens the admin's own popover to change it: the
 * shape the list view uses for Columns and Filters, so the queue adds no second kind of
 * control. The popover is portalled, so nothing around it can clip it.
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

	return (
		<Popup
			// No `onClick`: `Popup` wraps its trigger in a button, and `Pill` renders one of its
			// own as soon as it is given a handler.
			button={
				<Pill icon={<ChevronIcon />} pillStyle="light" size="small">
					{`${groupLabel}: ${selected?.label ?? ''}`}
				</Pill>
			}
			className="dedupe-choice"
			horizontalAlign="left"
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
			size="medium"
			verticalAlign="bottom"
		/>
	)
}
