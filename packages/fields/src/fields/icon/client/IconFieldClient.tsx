'use client'

import {
	Drawer,
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	formatDrawerSlug,
	RenderCustomComponent,
	useEditDepth,
	useField,
	useModal,
	XIcon,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations'
import { useTranslation } from '../../../translations/useTranslation'
import type { IconMeta } from '../../../types'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { resolveIconDisplay } from '../shared/iconLabel'
import { formatIconValue, resolveIconValue } from '../shared/value'
import { filterAvailableLibraries, pickInitialLibrary } from './availableLibraries'
import './icon-field.css'

const IconDrawerContent = React.lazy(() => import('./IconDrawerContent'))

/** Muted grid glyph shown in the square when the field has no value: a picker affordance, not a value. */
const PlaceholderGlyph: React.FC = () => (
	<svg aria-hidden="true" fill="currentColor" height={20} viewBox="0 0 20 20" width={20}>
		<rect height="6" rx="1.5" width="6" x="3" y="3" />
		<rect height="6" rx="1.5" width="6" x="11" y="3" />
		<rect height="6" rx="1.5" width="6" x="3" y="11" />
		<rect height="6" rx="1.5" width="6" x="11" y="11" />
	</svg>
)

const WarningIcon: React.FC = () => (
	<svg aria-hidden="true" fill="none" height={16} viewBox="0 0 16 16" width={16}>
		<path d="M8 1.75 15 14H1z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
		<path d="M8 6.25v3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
		<circle cx="8" cy="11.75" fill="currentColor" r="0.85" />
	</svg>
)

export type IconFieldClientExtraProps = {
	adapterComponents: Record<string, AdapterComponentsEntry>
	adapters: { label: string; slug: string }[]
	available: string[]
	defaultLibrary: string
	/**
	 * Manifest entry for the value this field rendered with, resolved server-side.
	 * The trigger has only a stored value, so without this a library-supplied label
	 * could not appear until the editor opened the drawer.
	 */
	selectedMeta?: IconMeta | null
	showTextInput: boolean
}

export type IconFieldClientProps = IconFieldClientExtraProps & TextFieldClientProps

export const IconField: React.FC<IconFieldClientProps> = (props) => {
	const {
		adapterComponents,
		adapters,
		available,
		defaultLibrary,
		field,
		path: pathFromProps,
		readOnly,
		selectedMeta,
		showTextInput,
	} = props
	const { i18n, t } = useTranslation()
	const editDepth = useEditDepth()
	const { closeModal, isModalOpen, openModal } = useModal()

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps })

	const drawerSlug = formatDrawerSlug({ slug: `fields-icon-${path}`, depth: editDepth })
	const isDisabled = Boolean(readOnly || disabled || field.admin?.readOnly)
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	const resolved = value ? resolveIconValue(value, defaultLibrary) : null
	const registeredSlugs = useMemo(
		() => new Set(adapters.map((adapter) => adapter.slug)),
		[adapters]
	)
	const isUnavailable =
		resolved !== null &&
		(!registeredSlugs.has(resolved.library) || !available.includes(resolved.library))
	const previewEntry = resolved ? adapterComponents[resolved.library] : undefined
	const hasGlyph = Boolean(resolved && previewEntry)

	// Manifest entries by stored value, seeded with the server's answer for the value
	// this field rendered with and extended whenever the editor picks. A pick has to
	// relabel the trigger immediately, and the manifest only lives inside the drawer.
	const knownMeta = useRef(new Map<string, IconMeta>())
	if (value && selectedMeta && !knownMeta.current.has(value)) {
		knownMeta.current.set(value, selectedMeta)
	}
	const displayLabel = resolved
		? resolveIconDisplay({
				language: i18n.language,
				meta: value ? knownMeta.current.get(value) : undefined,
				name: resolved.name,
			}).label
		: ''

	const availableAdapters = useMemo(
		() => filterAvailableLibraries(adapters, available),
		[adapters, available]
	)
	const [activeLibrary, setActiveLibrary] = useState(() =>
		pickInitialLibrary({ available, defaultLibrary, selectedLibrary: resolved?.library ?? null })
	)

	// Text-input mode shows the raw `library:name` while focused for editing and the
	// formatted label otherwise, so the editor never has to read a colon-prefixed value.
	const [editing, setEditing] = useState(false)

	const handleSelect = useCallback(
		(library: string, icon: IconMeta) => {
			const next = formatIconValue(library, icon.name)
			knownMeta.current.set(next, icon)
			setValue(next)
			closeModal(drawerSlug)
		},
		[closeModal, drawerSlug, setValue]
	)

	const triggerDisabled = isDisabled || availableAdapters.length === 0
	const glyphClass = `tenx-icon-field__glyph${hasGlyph ? '' : ' tenx-icon-field__glyph--empty'}`
	const glyph =
		resolved && previewEntry ? (
			<previewEntry.Icon name={resolved.name} size={20} />
		) : (
			<PlaceholderGlyph />
		)

	const wrapperClasses = [
		fieldBaseClass,
		'tenx-icon-field',
		field.admin?.className,
		showError ? 'error' : null,
		isDisabled ? 'read-only' : null,
	]
		.filter(Boolean)
		.join(' ')

	const controlClasses = `tenx-icon-field__control${isUnavailable ? ' tenx-icon-field__control--warning' : ''}`

	return (
		<div className={wrapperClasses} id={`field-${path.replace(/\./g, '__')}`} style={styles}>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel
						label={field.label}
						localized={field.localized}
						path={path}
						required={field.required}
					/>
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{BeforeInput}
				<div className={controlClasses}>
					{showTextInput ? (
						<>
							<button
								aria-expanded={isModalOpen(drawerSlug)}
								aria-haspopup="dialog"
								aria-label={t(keys.selectIcon)}
								className={glyphClass}
								disabled={triggerDisabled}
								onClick={() => openModal(drawerSlug)}
								type="button"
							>
								{glyph}
							</button>
							<input
								aria-label={t(keys.fieldIconLabel)}
								className="tenx-icon-field__value tenx-icon-field__value--input"
								onBlur={() => setEditing(false)}
								onChange={(event) => setValue(event.target.value || null)}
								onFocus={() => setEditing(true)}
								placeholder={t(keys.textInputPlaceholder)}
								readOnly={isDisabled}
								type="text"
								value={editing ? (value ?? '') : displayLabel}
							/>
						</>
					) : (
						<button
							aria-expanded={isModalOpen(drawerSlug)}
							aria-haspopup="dialog"
							className="tenx-icon-field__open"
							disabled={triggerDisabled}
							onClick={() => openModal(drawerSlug)}
							type="button"
						>
							<span aria-hidden="true" className={glyphClass}>
								{glyph}
							</span>
							<span className="tenx-icon-field__value">
								{resolved ? (
									displayLabel
								) : (
									<span className="tenx-icon-field__placeholder">{t(keys.selectIcon)}</span>
								)}
							</span>
						</button>
					)}
					{isUnavailable ? (
						<span className="tenx-icon-field__marker" title={t(keys.iconUnavailable)}>
							<WarningIcon />
							<span className="tenx-icon-field__sr-only">{t(keys.iconUnavailable)}</span>
						</span>
					) : null}
					{value && !field.required && !isDisabled ? (
						<button
							aria-label={t(keys.clearIcon)}
							className="tenx-icon-field__clear"
							onClick={() => {
								setValue(null)
								setEditing(false)
							}}
							type="button"
						>
							<XIcon />
						</button>
					) : null}
				</div>
				{AfterInput}
				<RenderCustomComponent
					CustomComponent={Description}
					Fallback={<FieldDescription description={field.admin?.description} path={path} />}
				/>
			</div>
			<Drawer className="tenx-icon-drawer-modal" slug={drawerSlug} title={t(keys.selectIcon)}>
				<Suspense fallback={<div className="tenx-icon-drawer__loading" />}>
					<IconDrawerContent
						activeLibrary={activeLibrary}
						adapterComponents={adapterComponents}
						adapters={availableAdapters}
						onLibraryChange={setActiveLibrary}
						onSelect={handleSelect}
						selected={resolved}
						slugPrefix={drawerSlug}
					/>
				</Suspense>
			</Drawer>
		</div>
	)
}
