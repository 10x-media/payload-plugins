'use client'

/**
 * Visible placeholder for a consumer block whose renderer could not be
 * resolved: reads the slug from the node's own `blockType` field so broken
 * wiring is obvious instead of content silently vanishing.
 */
export const MissingBlockRenderer = ({ fields }: { fields: Record<string, unknown> }) => (
	<p className="wiki-guide-article__missing-block">
		{`No renderer for block "${typeof fields.blockType === 'string' ? fields.blockType : 'unknown'}"`}
	</p>
)
