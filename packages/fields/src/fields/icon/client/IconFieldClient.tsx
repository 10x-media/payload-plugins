'use client'

import {
	Button,
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
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import React, { Suspense, useCallback, useMemo, useState } from 'react'
import { keys } from '../../../translations'
import { useTranslation } from '../../../translations/useTranslation'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { formatIconValue, resolveIconValue } from '../shared/value'
import './icon-field.css'

const IconDrawerContent = React.lazy(() => import('./IconDrawerContent'))

export type IconFieldClientExtraProps = {
	adapterComponents: Record<string, AdapterComponentsEntry>
	adapters: { label: string; slug: string }[]
	available: string[]
	defaultLibrary: string
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
		showTextInput,
	} = props
	const { t } = useTranslation()
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

	const initialLibrary =
		resolved && available.includes(resolved.library)
			? resolved.library
			: available.includes(defaultLibrary)
				? defaultLibrary
				: (available[0] ?? defaultLibrary)
	const [activeLibrary, setActiveLibrary] = useState(initialLibrary)

	const availableAdapters = useMemo(
		() => adapters.filter((adapter) => available.includes(adapter.slug)),
		[adapters, available]
	)

	const handleSelect = useCallback(
		(library: string, name: string) => {
			setValue(formatIconValue(library, name))
			closeModal(drawerSlug)
		},
		[closeModal, drawerSlug, setValue]
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
			<div className="field-type__wrap">
				{BeforeInput}
				<div className="tenx-icon-field__row">
					<button
						aria-haspopup="dialog"
						className="tenx-icon-field__trigger"
						disabled={isDisabled || availableAdapters.length === 0}
						onClick={() => openModal(drawerSlug)}
						type="button"
					>
						{resolved ? (
							<>
								<span className="tenx-icon-field__preview">
									{previewEntry ? <previewEntry.Icon name={resolved.name} size={20} /> : null}
								</span>
								<span className="tenx-icon-field__name">{value}</span>
							</>
						) : (
							<span className="tenx-icon-field__placeholder">{t(keys.selectIcon)}</span>
						)}
					</button>
					{isUnavailable ? (
						<span className="tenx-icon-field__hint">{t(keys.libraryUnavailable)}</span>
					) : null}
					{value && !field.required && !isDisabled ? (
						<Button
							aria-label={t(keys.clearIcon)}
							buttonStyle="icon-label"
							icon="x"
							iconStyle="with-border"
							margin={false}
							onClick={() => setValue(null)}
						/>
					) : null}
					{showTextInput ? (
						<input
							aria-label={t(keys.fieldIconLabel)}
							className="tenx-icon-field__text-input"
							disabled={isDisabled}
							onChange={(event) => setValue(event.target.value)}
							placeholder={t(keys.textInputPlaceholder)}
							type="text"
							value={value ?? ''}
						/>
					) : null}
				</div>
				{AfterInput}
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field.admin?.description} path={path} />}
			/>
			<Drawer className="tenx-icon-drawer-modal" slug={drawerSlug} title={t(keys.selectIcon)}>
				{isModalOpen(drawerSlug) ? (
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
				) : null}
			</Drawer>
		</div>
	)
}
