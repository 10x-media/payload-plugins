import type { Field } from 'payload'

import { WikiFieldDescription } from './WikiFieldDescription'

/**
 * What a description function needs from `i18n`, typed structurally so the
 * package keeps its distance from `@payloadcms/translations`, which it does not
 * depend on (same reasoning as `TargetSelect/clientBlocks.ts`).
 */
type DescriptionI18n = { t: unknown }

type DescriptionFn = (args: { i18n: unknown; t: unknown }) => string

export type WikiFieldDescriptionServerProps = {
	/** The server field config, handed to every Description via `serverProps`. */
	field?: Field
	i18n?: DescriptionI18n
	path?: string
	schemaPath: string
}

/**
 * The walker's Description for fields whose `admin.description` is a function.
 *
 * A function cannot ride along in `clientProps`, but it does not have to: the
 * config it belongs to reaches every server Description through `serverProps`,
 * so this component calls it exactly as Payload's own `renderField` does and
 * passes the resulting string down. Everything after that is the client
 * component's job, unchanged.
 *
 * Fields with a static description skip this hop and get `WikiFieldDescription`
 * directly, so the extra server component is paid for only where it is needed.
 */
export const WikiFieldDescriptionServer = ({
	field,
	i18n,
	path,
	schemaPath,
}: WikiFieldDescriptionServerProps) => {
	const description = (field as undefined | { admin?: { description?: unknown } })?.admin
		?.description
	const resolved =
		typeof description === 'function' && i18n
			? (description as DescriptionFn)({ i18n, t: i18n.t })
			: undefined

	return <WikiFieldDescription description={resolved ?? null} path={path} schemaPath={schemaPath} />
}
