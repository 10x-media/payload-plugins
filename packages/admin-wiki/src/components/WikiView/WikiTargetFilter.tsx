'use client'

import { Button, ChevronIcon, Popup, SearchIcon, Switch, XIcon } from '@payloadcms/ui'
import { useId, useState } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './wiki-target-filter.css'

export type WikiTargetFilterOption = {
	/** `kind:value`, the key the guide list filters on. */
	key: string
	label: string
}

export type WikiTargetFilterProps = {
	onToggle: (key: string) => void
	options: WikiTargetFilterOption[]
	selected: string[]
}

/**
 * The wiki index's target filter, drawn as Payload 4's Columns control: a
 * secondary button with a chevron that reads as selected while open or
 * filtering, opening a dialog popup with a title, a search bar, and one row per
 * target with a `Switch`. Payload's own column selector is neither exported nor
 * generic (it takes `Column[]`), so this rebuilds it from the exported pieces;
 * its metrics come from `elements/ColumnSelection/Popup.css`.
 *
 * A popup of switches rather than the where builder: guides attach to whole
 * surfaces, so turning surfaces on and off is the entire query a reader can
 * express, the same shape as choosing columns.
 */
export const WikiTargetFilter = ({ onToggle, options, selected }: WikiTargetFilterProps) => {
	const { t } = useTranslation()
	const [search, setSearch] = useState('')
	const searchId = useId()
	const needle = search.trim().toLowerCase()
	const visible = needle
		? options.filter((option) => option.label.toLowerCase().includes(needle))
		: options

	return (
		<Popup
			className="wiki-target-filter"
			horizontalAlign="right"
			popupAriaLabel={t(keys.wikiFilterLabel)}
			popupType="dialog"
			render={({ close }) => (
				<div className="wiki-target-filter__panel">
					<div className="wiki-target-filter__header">
						<h2 className="wiki-target-filter__title">{t(keys.wikiFilterLabel)}</h2>
						<Button
							aria-label={t('general:close')}
							buttonStyle="ghost"
							className="wiki-target-filter__close"
							icon={<XIcon size={24} />}
							margin={false}
							onClick={close}
						/>
					</div>
					<div className="wiki-target-filter__search">
						<label className="wiki-target-filter__search-bar" htmlFor={searchId}>
							<SearchIcon size={24} />
							<input
								className="wiki-target-filter__search-input"
								id={searchId}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t(keys.wikiFilterSearch)}
								type="search"
								value={search}
							/>
						</label>
					</div>
					<div className="wiki-target-filter__content">
						{visible.length === 0 ? (
							<p className="wiki-target-filter__no-results">{t(keys.wikiFilterNoResults)}</p>
						) : (
							<ul className="wiki-target-filter__list">
								{visible.map((option) => {
									const active = selected.includes(option.key)
									return (
										<li
											className={[
												'wiki-target-filter__item',
												!active && 'wiki-target-filter__item--inactive',
											]
												.filter(Boolean)
												.join(' ')}
											key={option.key}
										>
											<span className="wiki-target-filter__item-label">{option.label}</span>
											<Switch
												ariaLabel={option.label}
												checked={active}
												onChange={() => onToggle(option.key)}
											/>
										</li>
									)
								})}
							</ul>
						)}
					</div>
				</div>
			)}
			renderButton={({ active, ...props }) => (
				<Button
					{...props}
					buttonStyle="secondary"
					className="wiki-target-filter__button"
					icon={<ChevronIcon direction={active ? 'up' : 'down'} size={16} />}
					margin={false}
					selected={active || selected.length > 0}
					size="medium"
				>
					{t(keys.wikiFilterLabel)}
				</Button>
			)}
			theme="auto"
			verticalAlign="bottom"
		/>
	)
}
