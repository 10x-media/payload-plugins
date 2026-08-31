'use client'

import { DefaultListView } from '@payloadcms/ui'
import type { ListViewClientProps } from 'payload'

/**
 * A host's own list view, so `curated` exercises the branch where the plugin must not swap.
 * Renders Payload's default so the collection stays usable, and marks itself so a test can
 * assert the plugin left it alone.
 */
export const CuratedListView: React.FC<ListViewClientProps> = (props) => (
	<>
		<div data-testid="curated-list-view" hidden />
		<DefaultListView {...props} />
	</>
)
