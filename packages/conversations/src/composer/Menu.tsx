'use client'

import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useComposerClasses } from './classes'

/** Space kept between a floating box and the viewport edge. */
const EDGE = 8

/**
 * Keeps a floating box inside the viewport: below its anchor when there is
 * room, above it otherwise, and shifted left when it would overflow the right
 * edge. `anchor` returns the viewport rect of the caret or element it belongs
 * to. Re-measures after every render, on the next frame, and on scroll or
 * resize.
 */
export const useFloatingPlacement = (anchor: () => DOMRect | null) => {
	const ref = useRef<HTMLDivElement>(null)
	const [style, setStyle] = useState<React.CSSProperties>({
		left: 0,
		// Not `visibility: hidden`: a hidden field cannot take focus on mount.
		opacity: 0,
		pointerEvents: 'none',
		position: 'fixed',
		top: 0,
	})
	const [, remeasure] = useState(0)
	useEffect(() => {
		const again = () => remeasure((value) => value + 1)
		const frame = requestAnimationFrame(again)
		window.addEventListener('resize', again)
		window.addEventListener('scroll', again, true)
		return () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('resize', again)
			window.removeEventListener('scroll', again, true)
		}
	}, [])
	useLayoutEffect(() => {
		const element = ref.current
		const rect = anchor()
		if (!element || !rect) return
		const box = element.getBoundingClientRect()
		const { height, width } = box
		// `fixed` is relative to the viewport unless an ancestor (a dialog it was
		// portalled into) has a transform; measure that offset and take it out.
		const originX = box.left - (Number.parseFloat(element.style.left) || 0)
		const originY = box.top - (Number.parseFloat(element.style.top) || 0)
		const below = rect.bottom + 4
		// Whole pixels: measured rects carry sub-pixel noise, and a style that
		// never settles would re-render forever.
		const top = Math.round(
			(below + height > window.innerHeight - EDGE && rect.top - height - 4 > EDGE
				? rect.top - height - 4
				: below) - originY
		)
		const left = Math.round(
			Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE)) - originX
		)
		setStyle((current) =>
			Math.abs(Number(current.top) - top) < 1 &&
			Math.abs(Number(current.left) - left) < 1 &&
			current.opacity === 1
				? current
				: { left, opacity: 1, position: 'fixed', top }
		)
	})
	return { ref, style }
}

/**
 * Where the caret is: the DOM selection while the editor holds it, else
 * Lexical's typeahead anchor, which sits a line under the matched text.
 */
export const caretRect = (anchor?: HTMLElement | null): DOMRect | null => {
	const selection = typeof window === 'undefined' ? null : window.getSelection()
	if (selection && selection.rangeCount > 0) {
		const rect = selection.getRangeAt(0).getBoundingClientRect()
		if (rect.height > 0) return rect
	}
	if (!anchor?.isConnected) return null
	const rect = anchor.getBoundingClientRect()
	const lineHeight = rect.height || 16
	return new DOMRect(rect.left, rect.top - lineHeight - 3, rect.width, lineHeight)
}

/**
 * Where floating parts render: the dialog the editor sits in (a modal traps
 * focus inside itself, so a field outside it could not be typed into), else
 * `body`. Outside any `overflow`, so nothing clips them.
 */
export const usePortalTarget = (): HTMLElement | null => {
	const [editor] = useLexicalComposerContext()
	if (typeof document === 'undefined') return null
	const root = editor.getRootElement()
	return root?.closest<HTMLElement>('dialog, [role="dialog"]') ?? document.body
}

/** One row; `group` draws a heading above the first row of each group. */
export type MenuEntry = { group?: ReactNode; groupKey?: string; key: string; node: ReactNode }

/**
 * The list both typeaheads render (`/` commands and `@` mentions), portalled
 * to `body` so no `overflow` clips it. Keyboard handling stays with Lexical's
 * typeahead plugin; this only draws.
 */
export const ComposerMenu = ({
	anchor,
	className,
	empty,
	entries,
	onHover,
	onPick,
	selectedIndex,
	setRef,
}: {
	anchor: HTMLElement | null
	className?: string
	empty?: ReactNode
	entries: MenuEntry[]
	onHover: (index: number) => void
	onPick: (index: number) => void
	selectedIndex: null | number
	setRef?: (index: number, element: HTMLElement | null) => void
}) => {
	const { ref, style } = useFloatingPlacement(() => caretRect(anchor))
	const cx = useComposerClasses()
	const target = usePortalTarget()
	if (!target) return null
	return createPortal(
		<div
			className={[cx('menu'), className].filter(Boolean).join(' ')}
			ref={ref}
			role="listbox"
			style={style}
		>
			{entries.length === 0 ? (
				<div className={cx('menuEmpty')}>{empty}</div>
			) : (
				entries.map((entry, index) => (
					<Fragment key={entry.key}>
						{entry.group && entry.groupKey !== entries[index - 1]?.groupKey ? (
							<div className={cx('menuGroup')}>{entry.group}</div>
						) : null}
						<button
							aria-selected={selectedIndex === index}
							className={cx('menuItem', selectedIndex === index && 'menuItemSelected')}
							onClick={() => onPick(index)}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => onHover(index)}
							ref={(element) => setRef?.(index, element)}
							role="option"
							tabIndex={-1}
							type="button"
						>
							{entry.node}
						</button>
					</Fragment>
				))
			)}
		</div>,
		target
	)
}
