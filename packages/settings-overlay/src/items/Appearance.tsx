'use client'

import type { AcceptedLanguages } from '@payloadcms/translations'
import {
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	type Theme,
	useConfig,
	useTheme,
	useTranslation,
} from '@payloadcms/ui'
import type React from 'react'

import './appearance.css'

const base = 'settings-overlay-appearance'

/** Ids the labels point at, mirroring Payload's own `field-<path>` convention. */
const THEME_GROUP_ID = 'field-settings-overlay-theme'
const LANGUAGE_ID = 'settings-overlay-language'

/**
 * `setTheme` is typed `(theme: Theme) => void` upstream, but its implementation branches on
 * 'auto' as well, and that is the value that deletes the cookie and hands the choice back to the
 * OS. The account view only gets away with passing it because its `RadioGroupField` onChange is
 * untyped.
 */
type SelectableTheme = 'auto' | Theme

const THEME_OPTIONS: {
	label: 'general:automatic' | 'general:dark' | 'general:light'
	value: SelectableTheme
}[] = [
	{ label: 'general:automatic', value: 'auto' },
	{ label: 'general:light', value: 'light' },
	{ label: 'general:dark', value: 'dark' },
]

/**
 * The two controls Payload otherwise offers only on `/admin/account`, lifted out of that document
 * form so they are reachable from anywhere.
 *
 * Neither is a user preference despite living on the account screen: both are browser cookies,
 * `<cookiePrefix>-theme` and `<cookiePrefix>-lng`, read back per request. This drives the same
 * `useTheme()` and `switchLanguage()` the account view does, so the two screens cannot disagree.
 *
 * The markup is borrowed too: `field-type`, `field-label`, `radio-group` and `radio-input` are
 * Payload's own class names, so both controls inherit the admin's field styling with nothing to
 * maintain. `RadioGroupField` itself is not reused because it calls `useField`, which needs a
 * Form context the panel does not have.
 */
export const SettingsOverlayAppearance: React.FC = () => {
	const { i18n, languageOptions, switchLanguage, t } = useTranslation()
	const { config } = useConfig()
	const { autoMode, setTheme, theme } = useTheme()

	// `admin.theme` pinned to 'light' or 'dark' takes the choice away entirely, the same gate the
	// account view applies before rendering its toggle.
	const themeIsSelectable = config.admin.theme === 'all'
	const selectedTheme: SelectableTheme = autoMode ? 'auto' : theme

	return (
		<div className={base}>
			<div className={`field-type ${base}__field`}>
				<FieldLabel htmlFor={LANGUAGE_ID} label={t('general:language')} />
				<div className="field-type__wrap">
					<ReactSelect
						inputId={LANGUAGE_ID}
						isClearable={false}
						onChange={(option: ReactSelectOption | ReactSelectOption[]) => {
							// ReactSelect types onChange for the multi case too; this one is single-select.
							const picked = Array.isArray(option) ? option[0] : option
							if (typeof picked?.value === 'string') {
								void switchLanguage?.(picked.value as AcceptedLanguages)
							}
						}}
						options={languageOptions}
						value={languageOptions?.find((language) => language.value === i18n.language)}
					/>
				</div>
			</div>

			{themeIsSelectable ? (
				<div className={`field-type radio-group radio-group--layout-horizontal ${base}__field`}>
					{/* Points at the <ul>, exactly as RadioGroupField's label does: not a click target,
					    but it keeps the element a real <label> and so keeps Payload's label styling. */}
					<FieldLabel htmlFor={THEME_GROUP_ID} label={t('general:adminTheme')} />
					<div className="field-type__wrap">
						<ul className="radio-group--group" id={THEME_GROUP_ID}>
							{THEME_OPTIONS.map(({ label, value }) => {
								const isSelected = selectedTheme === value
								const id = `${THEME_GROUP_ID}-${value}`

								return (
									<li key={value}>
										<label htmlFor={id}>
											<div
												className={['radio-input', isSelected && 'radio-input--is-selected']
													.filter(Boolean)
													.join(' ')}
											>
												<input
													checked={isSelected}
													id={id}
													name={THEME_GROUP_ID}
													onChange={() => {
														setTheme(value as Theme)
													}}
													type="radio"
												/>
												<span className="radio-input__styled-radio" />
												<span className="radio-input__label">{t(label)}</span>
											</div>
										</label>
									</li>
								)
							})}
						</ul>
					</div>
				</div>
			) : null}
		</div>
	)
}
