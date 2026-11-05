'use client'

import type { SignalView } from '../queue/pairs'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

const PHRASE: Record<SignalView['kind'], TranslationKey> = {
	match: keys.whySame,
	similar: keys.whySimilar,
	veto: keys.whyVeto,
	differ: keys.whyDiffer,
}

/**
 * Why two documents look alike, in one line: the fields they share first, a near match with
 * how near, then, muted, the ones that tell them apart.
 */
export const Signals = ({ signals }: { signals: SignalView[] }) => {
	const { t } = useTranslation()
	const phrases = (kinds: (keyof typeof PHRASE)[]) =>
		kinds.flatMap((kind) => {
			const fields = signals
				.filter((signal) => signal.kind === kind)
				.map((signal) =>
					kind === 'similar'
						? `${signal.label} (${Math.round(signal.similarity * 100)}%)`
						: signal.label
				)
				.join(', ')
			return fields ? [t(PHRASE[kind], { fields })] : []
		})
	const alike = phrases(['match', 'similar'])
	const apart = phrases(['veto', 'differ'])
	if (alike.length === 0 && apart.length === 0) return null
	return (
		<span className="dedupe-signals">
			{alike.join(' · ')}
			{apart.length > 0 ? (
				<span className="dedupe-signals__apart">
					{alike.length > 0 ? ' · ' : ''}
					{apart.join(' · ')}
				</span>
			) : null}
		</span>
	)
}
