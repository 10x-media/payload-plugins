'use client'

import { Collapsible, CopyToClipboard } from '@payloadcms/ui'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { flattenEntries } from './flatten'
import { formatValue, isLongValue } from './utils'

/**
 * A snapshot or a custom event's metadata as the diff table shows a change: one row
 * per path, so it reads the same way. The raw JSON stays one click away for copying.
 */
export function ValueTable({ value }: { value: Record<string, unknown> }) {
	const { t } = useTranslation()
	const rows = flattenEntries(value)
	const json = JSON.stringify(value, null, 2)

	return (
		<>
			{rows.length > 0 && (
				<table className="al-diff">
					<thead>
						<tr>
							<th className="al-diff__th al-diff__col-path">{t(keys.diffPath)}</th>
							<th className="al-diff__th">{t(keys.diffValue)}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(([path, leaf]) => (
							<tr className="al-diff__row" key={path}>
								<td className="al-diff__td al-diff__col-path">
									<code className="al-diff__path">{path}</code>
								</td>
								<td className="al-diff__td">
									{isLongValue(leaf) ? (
										<pre className="al-diff__json">{formatValue(leaf)}</pre>
									) : (
										formatValue(leaf)
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<Collapsible
				actions={<CopyToClipboard value={json} />}
				className="al-raw-json"
				header={t(keys.rawJson)}
				initCollapsed
			>
				<pre className="al-json-block">{json}</pre>
			</Collapsible>
		</>
	)
}
