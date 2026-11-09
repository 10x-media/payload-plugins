'use client'

import { CheckIcon, ChevronIcon, MoreIcon, WriteIcon } from '@payloadcms/ui'

import type { ComposerIcons } from '../composer/iconSet'

/*
 * Path data of Payload's rich text editor icons (`@payloadcms/richtext-lexical`,
 * MIT), which the package does not export. Copied so the admin composer draws
 * exactly the icons of a native rich text field; recheck them on a Payload bump.
 */
const BOLD =
	'M14.5 9.25A1.75 1.75 0 0 1 12.75 11H9.5V7.5h3.25c.966 0 1.75.784 1.75 1.75M8 11V7.5A1.5 1.5 0 0 1 9.5 6h3.25a3.25 3.25 0 0 1 2.418 5.422A3.5 3.5 0 0 1 13.5 18h-4A1.5 1.5 0 0 1 8 16.5zm1.5 1.5v4h4a2 2 0 1 0 0-4z'
const ITALIC =
	'M10 6.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-2.083L11.6 17h1.9a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2.083L12.4 7h-1.9a.5.5 0 0 1-.5-.5'
const LINK =
	'M12.4436 10.3708C12.6861 10.5041 12.9148 10.6721 13.1204 10.8776C14.2919 12.0492 14.2918 13.9482 13.1204 15.1198L11.1204 17.1198C9.94879 18.2914 8.04975 18.2914 6.87817 17.1198C5.70664 15.9482 5.70661 14.0492 6.87817 12.8776L8.1477 11.6071C8.4098 11.345 8.89329 11.5392 8.97388 11.9011C9.00617 12.0462 8.96861 12.2012 8.86353 12.3063L7.5852 13.5847C6.80417 14.3657 6.80419 15.6317 7.5852 16.4128C8.36625 17.1938 9.63228 17.1938 10.4133 16.4128L12.4133 14.4128C13.1942 13.6317 13.1943 12.3657 12.4133 11.5847C12.4042 11.5755 12.3953 11.5662 12.386 11.5573C12.2925 11.468 12.1984 11.3736 12.1614 11.2497C12.0724 10.9515 12.1448 10.6149 12.3801 10.3796C12.397 10.3628 12.4228 10.3594 12.4436 10.3708ZM12.8782 6.87764C14.0497 5.70615 15.9488 5.70616 17.1204 6.87764C18.2919 8.04919 18.2919 9.94825 17.1204 11.1198L15.8508 12.3903C15.5887 12.6522 15.1053 12.4581 15.0247 12.0964C14.9924 11.9512 15.0308 11.7963 15.136 11.6911L16.4133 10.4128C17.1943 9.63175 17.1943 8.3657 16.4133 7.58467C15.6323 6.80371 14.3662 6.8037 13.5852 7.58467L11.5852 9.58467C10.8046 10.3657 10.8044 11.6319 11.5852 12.4128C11.5943 12.4219 11.6042 12.4303 11.6135 12.4392C11.7064 12.5278 11.7999 12.622 11.8372 12.7448C11.9276 13.044 11.8545 13.3827 11.6184 13.6188C11.6023 13.6347 11.5778 13.6383 11.5579 13.6276C11.3146 13.4942 11.0843 13.3259 10.8782 13.1198C9.7068 11.9484 9.707 10.0492 10.8782 8.87764L12.8782 6.87764Z'
const UNORDERED_LIST =
	'M7 16C7.55228 16 8 16.4477 8 17C8 17.5523 7.55228 18 7 18C6.44772 18 6 17.5523 6 17C6 16.4477 6.44772 16 7 16ZM17.5 16.5C17.7761 16.5 18 16.7239 18 17C18 17.2761 17.7761 17.5 17.5 17.5H10.5C10.2239 17.5 10 17.2761 10 17C10 16.7239 10.2239 16.5 10.5 16.5H17.5ZM7 11C7.55228 11 8 11.4477 8 12C8 12.5523 7.55228 13 7 13C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11ZM17.5 11.5C17.7761 11.5 18 11.7239 18 12C18 12.2761 17.7761 12.5 17.5 12.5H10.5C10.2239 12.5 10 12.2761 10 12C10 11.7239 10.2239 11.5 10.5 11.5H17.5ZM7 6C7.55228 6 8 6.44772 8 7C8 7.55228 7.55228 8 7 8C6.44772 8 6 7.55228 6 7C6 6.44772 6.44772 6 7 6ZM17.5 6.5C17.7761 6.5 18 6.72386 18 7C18 7.27614 17.7761 7.5 17.5 7.5H10.5C10.2239 7.5 10 7.27614 10 7C10 6.72386 10.2239 6.5 10.5 6.5H17.5Z'
const ORDERED_LIST =
	'M11 7a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6A.5.5 0 0 1 11 7M6 7a.5.5 0 0 1 .5-.5h1A.5.5 0 0 1 8 7v3.5a.5.5 0 1 1-1 0v-3h-.5A.5.5 0 0 1 6 7m0 6.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V15a.5.5 0 0 1-.276.447L7 16.31v.191h1.5a.5.5 0 0 1 0 1h-2A.5.5 0 0 1 6 17v-1a.5.5 0 0 1 .276-.447L8 14.69V14H6.5a.5.5 0 0 1-.5-.5m5.5 3a.5.5 0 1 0 0 1h6a.5.5 0 0 0 0-1zm0-5a.5.5 0 1 0 0 1h6a.5.5 0 0 0 0-1z'
const TRASH_SMALL =
	'M6.5 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-.039l-.08 1H17a.5.5 0 0 1 0 1h-.7l-.455 5.62A1.5 1.5 0 0 1 14.35 18h-4.7a1.5 1.5 0 0 1-1.495-1.38L7.7 11H7a.5.5 0 0 1 0-1h.62l-.081-1H7.5a1 1 0 0 1-1-1zm9.494 1h.506V7h-9v1zm-.536 1H8.542l.61 7.54a.5.5 0 0 0 .498.46h4.7a.5.5 0 0 0 .499-.46zM11.5 11.5a.5.5 0 0 0-1 0v3a.5.5 0 0 0 1 0zm2 0a.5.5 0 0 0-1 0v3a.5.5 0 0 0 1 0z'

/** A 24px icon in Payload's style: one filled path on `currentColor`. */
const filled = (d: string, evenOdd = true) => {
	const Icon = () => (
		<svg
			aria-hidden="true"
			className="icon"
			fill="none"
			focusable="false"
			height={24}
			viewBox="0 0 24 24"
			width={24}
		>
			<path
				clipRule={evenOdd ? 'evenodd' : undefined}
				d={d}
				fill="currentColor"
				fillRule={evenOdd ? 'evenodd' : undefined}
			/>
		</svg>
	)
	return Icon
}

/** Payload's editor has no mention icon: an `@` drawn at the weight of its icons. */
const MentionIcon = () => (
	<svg
		aria-hidden="true"
		className="icon"
		fill="none"
		focusable="false"
		height={24}
		viewBox="0 0 24 24"
		width={24}
	>
		<circle cx="12" cy="12" r="2.5" stroke="currentColor" />
		<path
			d="M14.5 12v1a1.75 1.75 0 0 0 3.5 0v-1a6 6 0 1 0-2.4 4.8"
			stroke="currentColor"
			strokeLinecap="round"
		/>
	</svg>
)

const Caret = () => <ChevronIcon direction="down" size={16} />
const More = () => <MoreIcon />
const Apply = () => <CheckIcon />
const Edit = () => <WriteIcon />

/**
 * The admin composer's icons: those of Payload's own rich text field, so the
 * toolbar, menus and link tooltip read as Payload's editor.
 */
export const payloadComposerIcons: ComposerIcons = {
	bold: filled(BOLD),
	bulletList: filled(UNORDERED_LIST, false),
	caret: Caret,
	italic: filled(ITALIC),
	link: filled(LINK, false),
	linkApply: Apply,
	linkEdit: Edit,
	linkLeading: filled(LINK, false),
	linkRemove: filled(TRASH_SMALL),
	mention: MentionIcon,
	more: More,
	numberedList: filled(ORDERED_LIST),
}
