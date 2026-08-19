'use client'

import type { OptionObject, TextFieldClientProps } from 'payload'
import { useMemo } from 'react'

import type { ResolvedWikiCustomTarget } from '../../plugin/resolveOptions'
import { useTranslation } from '../../translations/useTranslation'
import { resolveClientLabel } from './clientBlocks'
import { TargetMultiSelect } from './TargetMultiSelect'

export type WikiTargetCustomProps = {
	/**
	 * Injected client prop: the targets the host declared through
	 * `customTargets`, in declaration order.
	 */
	targets: ResolvedWikiCustomTarget[]
} & TextFieldClientProps

/**
 * The custom target list: a multi-select over the surfaces the host declared
 * itself, since nothing in the config describes them.
 *
 * Labels are resolved here rather than at config time because a declared label
 * may be keyed by admin language, and config time has no request to read one
 * from. Stored values stay bare keys, so a target whose declaration is later
 * removed still shows here and still surfaces in the orphan banner.
 */
export const WikiTargetCustom = ({ targets, ...props }: WikiTargetCustomProps) => {
	const { i18n } = useTranslation()

	const options = useMemo<OptionObject[]>(
		() =>
			targets.map((target) => ({
				label: resolveClientLabel(target.label, i18n.language, target.key),
				value: target.key,
			})),
		[i18n.language, targets]
	)

	return <TargetMultiSelect {...props} options={options} />
}
