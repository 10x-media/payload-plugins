import { DefaultTemplate } from '@payloadcms/next/templates'
import { File, Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'

import { getRegistry } from '../src/plugin/registry'
import { createFileIconSet, svgDataUri } from '../src/shared/fileIcons'
import './file-icons.css'

/** Payload renders thumbnails at these sizes: the edit-view upload area, then list and field rows. */
const SIZES = [150, 64, 40]

/**
 * Dev-only gallery of the file-type icons at the sizes Payload shows thumbnails,
 * beside Payload's own fallback for comparison.
 */
export const FileIconsView = ({
	i18n,
	initPageResult,
	params,
	payload,
	searchParams,
}: AdminViewServerProps) => {
	const { permissions, req, visibleEntities } = initPageResult
	const icons = createFileIconSet(getRegistry(payload.config)?.fileIcons)
	return (
		<DefaultTemplate
			i18n={i18n}
			locale={initPageResult.locale}
			params={params}
			payload={payload}
			permissions={permissions}
			req={req}
			searchParams={searchParams}
			user={req.user ?? undefined}
			visibleEntities={{
				collections: visibleEntities?.collections,
				globals: visibleEntities?.globals,
			}}
		>
			<Gutter className="file-icons">
				<h1>File icons</h1>
				<p className="file-icons__lead">
					Each family at 150, 64 and 40 px, the sizes Payload shows thumbnails at. The first row is
					Payload&apos;s own fallback.
				</p>
				<div className="file-icons__grid">
					<figure className="file-icons__item">
						<div className="file-icons__sizes">
							{SIZES.map((size) => (
								<span
									className="file-icons__payload"
									key={size}
									style={{ height: size, width: size }}
								>
									<File />
								</span>
							))}
						</div>
						<figcaption>Payload File</figcaption>
					</figure>
					{icons.entries.map(({ key, label, svg }) => (
						<figure className="file-icons__item" key={key}>
							<div className="file-icons__sizes">
								{SIZES.map((size) => (
									<img alt={label} height={size} key={size} src={svgDataUri(svg)} width={size} />
								))}
							</div>
							<figcaption>{label}</figcaption>
						</figure>
					))}
				</div>
			</Gutter>
		</DefaultTemplate>
	)
}
