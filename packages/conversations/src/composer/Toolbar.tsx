'use client'

import { $getSelection, type LexicalEditor } from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useFloatingPlacement } from './Menu'
import { mergeToolbarGroups, pickToolbar } from './model'
import { useComposerRuntime } from './runtime'
import { type ComposerToolbarGroup, type ComposerToolbarItem, labelOf } from './types'

type ItemState = { active: boolean; enabled: boolean }
type States = Record<string, ItemState>

const idle: ItemState = { active: false, enabled: true }

const useLabel = () => {
	const { labels, t } = useComposerRuntime()
	return (label: ComposerToolbarItem['label'], fallback: string) =>
		labelOf(label, fallback, { labels, t })
}

const Caret = () => (
	<svg aria-hidden="true" fill="none" height="10" viewBox="0 0 10 10" width="10">
		<path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
	</svg>
)

const ItemButton = ({
	close,
	editor,
	item,
	state,
}: {
	close: () => void
	editor: LexicalEditor
	item: ComposerToolbarItem
	state: ItemState
}) => {
	const label = useLabel()(item.label, item.key)
	if (item.Component) {
		return (
			<item.Component
				active={state.active}
				close={close}
				editor={editor}
				enabled={state.enabled}
				item={item}
			/>
		)
	}
	return (
		<button
			aria-label={label}
			aria-pressed={state.active}
			className={`conversations-editor__tool${state.active ? ' conversations-editor__tool--active' : ''}`}
			disabled={!state.enabled}
			onClick={() => item.onSelect?.({ editor, isActive: state.active })}
			onMouseDown={(event) => event.preventDefault()}
			title={label}
			type="button"
		>
			{item.ChildComponent ? <item.ChildComponent /> : label}
		</button>
	)
}

const DropdownPanel = ({
	anchor,
	children,
	onClose,
}: {
	anchor: HTMLElement | null
	children: React.ReactNode
	onClose: () => void
}) => {
	const { ref, style } = useFloatingPlacement(() => anchor?.getBoundingClientRect() ?? null)
	useEffect(() => {
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node
			if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose()
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('mousedown', onDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [anchor, onClose, ref])
	return createPortal(
		<div
			className="conversations-menu conversations-menu--dropdown"
			ref={ref}
			role="menu"
			style={style}
		>
			{children}
		</div>,
		document.body
	)
}

/** Items as rows of a dropdown panel; an item's own `Component` renders as is. */
const MenuRows = ({
	close,
	editor,
	items,
	states,
}: {
	close: () => void
	editor: LexicalEditor
	items: ComposerToolbarItem[]
	states: States
}) => {
	const label = useLabel()
	return (
		<>
			{items.map((item) => {
				const state = states[item.key] ?? idle
				if (item.Component) {
					return (
						<item.Component
							active={state.active}
							close={close}
							editor={editor}
							enabled={state.enabled}
							item={item}
							key={item.key}
						/>
					)
				}
				return (
					<button
						aria-checked={state.active}
						className={`conversations-menu__item${state.active ? ' conversations-menu__item--selected' : ''}`}
						disabled={!state.enabled}
						key={item.key}
						onClick={() => {
							item.onSelect?.({ editor, isActive: state.active })
							close()
						}}
						onMouseDown={(event) => event.preventDefault()}
						role="menuitemcheckbox"
						type="button"
					>
						<span className="conversations-menu__icon">
							{item.ChildComponent ? <item.ChildComponent /> : null}
						</span>
						<span className="conversations-menu__label">{label(item.label, item.key)}</span>
					</button>
				)
			})}
		</>
	)
}

const Dropdown = ({
	editor,
	group,
	states,
}: {
	editor: LexicalEditor
	group: Extract<ComposerToolbarGroup, { type: 'dropdown' }>
	states: States
}) => {
	const label = useLabel()
	const [open, setOpen] = useState(false)
	const button = useRef<HTMLButtonElement>(null)
	const active = group.items.find((item) => states[item.key]?.active)
	const Icon = group.ChildComponent ?? active?.ChildComponent ?? group.items[0]?.ChildComponent
	const title = label(group.label, group.key)
	const close = () => setOpen(false)
	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={title}
				className={`conversations-editor__tool conversations-editor__tool--dropdown${active || open ? ' conversations-editor__tool--active' : ''}`}
				onClick={() => setOpen((value) => !value)}
				onMouseDown={(event) => event.preventDefault()}
				ref={button}
				title={title}
				type="button"
			>
				{Icon ? <Icon /> : title}
				<Caret />
			</button>
			{open ? (
				<DropdownPanel anchor={button.current} onClose={close}>
					<MenuRows close={close} editor={editor} items={group.items} states={states} />
				</DropdownPanel>
			) : null}
		</>
	)
}

/**
 * One piece of the toolbar that is shown or moved to "More" as a whole: a
 * button of a buttons group, or a whole dropdown group.
 */
type Unit =
	| { groupKey: string; item: ComposerToolbarItem; key: string; kind: 'item' }
	| {
			group: Extract<ComposerToolbarGroup, { type: 'dropdown' }>
			groupKey: string
			key: string
			kind: 'dropdown'
	  }

const toUnits = (groups: ComposerToolbarGroup[]): Unit[] =>
	groups.flatMap((group): Unit[] =>
		group.type === 'dropdown'
			? [{ group, groupKey: group.key, key: `group:${group.key}`, kind: 'dropdown' }]
			: group.items.map((item) => ({
					groupKey: group.key,
					item,
					key: `item:${item.key}`,
					kind: 'item',
				}))
	)

const MoreIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<circle cx="3.5" cy="8" fill="currentColor" r="1.2" />
		<circle cx="8" cy="8" fill="currentColor" r="1.2" />
		<circle cx="12.5" cy="8" fill="currentColor" r="1.2" />
	</svg>
)

/** The units that did not fit, in one dropdown; dropdown groups keep their title. */
const More = ({
	buttonRef,
	editor,
	states,
	units,
}: {
	buttonRef: React.RefObject<HTMLButtonElement | null>
	editor: LexicalEditor
	states: States
	units: Unit[]
}) => {
	const { labels } = useComposerRuntime()
	const label = useLabel()
	const [open, setOpen] = useState(false)
	const close = () => setOpen(false)
	const active = units.some((unit) =>
		unit.kind === 'item'
			? states[unit.item.key]?.active
			: unit.group.items.some((item) => states[item.key]?.active)
	)
	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={labels.more}
				className={`conversations-editor__tool${active || open ? ' conversations-editor__tool--active' : ''}`}
				onClick={() => setOpen((value) => !value)}
				onMouseDown={(event) => event.preventDefault()}
				ref={buttonRef}
				title={labels.more}
				type="button"
			>
				<MoreIcon />
			</button>
			{open ? (
				<DropdownPanel anchor={buttonRef.current} onClose={close}>
					{units.map((unit) =>
						unit.kind === 'item' ? (
							<MenuRows
								close={close}
								editor={editor}
								items={[unit.item]}
								key={unit.key}
								states={states}
							/>
						) : (
							<Fragment key={unit.key}>
								<div className="conversations-menu__group">
									{label(unit.group.label, unit.group.key)}
								</div>
								<MenuRows close={close} editor={editor} items={unit.group.items} states={states} />
							</Fragment>
						)
					)}
				</DropdownPanel>
			) : null}
		</>
	)
}

/** Width kept for the "More" button before it has been measured. */
const MORE_FALLBACK_PX = 32

/**
 * The formatting toolbar: every feature's groups, merged and ordered like
 * Payload's fixed toolbar. `items` narrows and reorders it by group or item
 * key. What does not fit the row moves, from the end, into a "More" menu, so
 * the send button is never pushed out.
 */
export const Toolbar = ({ items }: { items?: string[] }) => {
	const [editor] = useLexicalComposerContext()
	const { features } = useComposerRuntime()
	// Compared by value: callers pass fresh arrays on every render.
	const itemsKey = items?.join(',')
	const groups = useMemo(
		() => pickToolbar(mergeToolbarGroups(features), itemsKey ? itemsKey.split(',') : undefined),
		[features, itemsKey]
	)
	const units = useMemo(() => toUnits(groups), [groups])
	const [states, setStates] = useState<States>({})
	const [visible, setVisible] = useState(units.length)
	const row = useRef<HTMLDivElement>(null)
	const moreButton = useRef<HTMLButtonElement>(null)
	/** Unit widths, kept while a unit is hidden so it can come back when there is room. */
	const widths = useRef(new Map<string, number>())

	useEffect(() => {
		const all = groups.flatMap((group) => group.items)
		const compute = () =>
			editor.getEditorState().read(() => {
				const selection = $getSelection()
				const next: States = {}
				for (const item of all) {
					next[item.key] = {
						active: item.isActive?.({ editor, selection }) ?? false,
						enabled: item.isEnabled?.({ editor, selection }) ?? true,
					}
				}
				setStates((current) =>
					all.every(
						(item) =>
							current[item.key]?.active === next[item.key]?.active &&
							current[item.key]?.enabled === next[item.key]?.enabled
					)
						? current
						: next
				)
			})
		compute()
		return editor.registerUpdateListener(compute)
	}, [editor, groups])

	// Fit the row: measure what is rendered, reuse cached widths for what is hidden.
	useLayoutEffect(() => {
		const element = row.current
		if (!element) return
		const fit = () => {
			for (const node of element.querySelectorAll<HTMLElement>('[data-unit]')) {
				widths.current.set(node.dataset.unit as string, node.getBoundingClientRect().width)
			}
			const available = element.clientWidth
			const width = (unit: Unit) => widths.current.get(unit.key) ?? 0
			const total = units.reduce((sum, unit) => sum + width(unit), 0)
			let count = units.length
			if (total > available) {
				let used =
					moreButton.current?.parentElement?.getBoundingClientRect().width || MORE_FALLBACK_PX
				count = 0
				for (const unit of units) {
					if (used + width(unit) > available) break
					used += width(unit)
					count++
				}
			}
			setVisible((current) => (current === count ? current : count))
		}
		fit()
		const observer = new ResizeObserver(fit)
		observer.observe(element)
		return () => observer.disconnect()
	}, [units])

	if (units.length === 0) return <span />
	const shown = units.slice(0, visible)
	const hidden = units.slice(visible)
	return (
		<div className="conversations-editor__toolbar" ref={row} role="toolbar">
			{shown.map((unit, index) => (
				<span className="conversations-editor__unit" data-unit={unit.key} key={unit.key}>
					{index > 0 && shown[index - 1]?.groupKey !== unit.groupKey ? (
						<span aria-hidden="true" className="conversations-editor__divider" />
					) : null}
					{unit.kind === 'dropdown' ? (
						<Dropdown editor={editor} group={unit.group} states={states} />
					) : (
						<ItemButton
							close={() => undefined}
							editor={editor}
							item={unit.item}
							state={states[unit.item.key] ?? idle}
						/>
					)}
				</span>
			))}
			{hidden.length > 0 ? (
				<span className="conversations-editor__unit">
					<span aria-hidden="true" className="conversations-editor__divider" />
					<More buttonRef={moreButton} editor={editor} states={states} units={hidden} />
				</span>
			) : null}
		</div>
	)
}
