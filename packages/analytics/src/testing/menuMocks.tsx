import type { ReactNode } from 'react'

const noop = (): void => {}

/**
 * Stand-ins for `ChoiceMenu`'s Payload pieces in tests that mock `@payloadcms/ui`: the menu
 * always open, in a group (a fieldset) named as the popup is, its options radio items a test
 * picks by name.
 */
export const menuMocks = {
	ChevronIcon: () => null,
	Popup: ({
		popupAriaLabel,
		render,
		renderButton,
	}: {
		popupAriaLabel?: string
		render?: (args: { close: () => void }) => ReactNode
		renderButton?: (props: {
			active: boolean
			onClick: () => void
			onKeyDown: () => void
		}) => ReactNode
	}) => (
		<fieldset aria-label={popupAriaLabel}>
			{renderButton?.({ active: false, onClick: noop, onKeyDown: noop })}
			{render?.({ close: noop })}
		</fieldset>
	),
	PopupList: {
		RadioGroup: ({ children }: { children?: ReactNode }) => <div role="menu">{children}</div>,
		RadioGroupItem: ({
			active,
			children,
			onClick,
		}: {
			active?: boolean
			children?: ReactNode
			onClick?: () => void
		}) => (
			<button aria-checked={Boolean(active)} onClick={onClick} role="menuitemradio" type="button">
				{children}
			</button>
		),
	},
}
