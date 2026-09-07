import { describe, expect, it } from 'vitest'

import { keys } from '../translations/keys'
import { SettingsOverlayItemDispatcher } from './widgetDispatcher'

describe('the dispatcher widget', () => {
	it('explains itself rather than failing when a reader adds it to a dashboard', async () => {
		// What Payload hands a widget placed by hand: no `widgetData`, so no overlay to dispatch to.
		const node = (await SettingsOverlayItemDispatcher({
			req: { t: (key: string) => key },
		} as never)) as { props: { children: string } }

		expect(node.props.children).toBe(keys.widgetNotice)
	})
})
