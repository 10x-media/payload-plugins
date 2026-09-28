export type ScreenshotProps = {
	/** What the still shows, for anyone who cannot see it. */
	alt: string
	/** A line under the image. */
	caption?: string
	/** Path under `public/`, e.g. `/images/conversations/panel.webp`. */
	src: string
	/**
	 * Display width in CSS px. Stills are rendered at 2x, so this is half the
	 * file's width; narrower containers scale it down.
	 */
	width: number
}

/**
 * A still of the UI, rendered by a clipwright scene into `public/images`. They
 * are dark-theme captures, which read fine on either docs theme.
 */
export const Screenshot = ({ alt, caption, src, width }: ScreenshotProps) => (
	<figure className="my-6">
		<img
			alt={alt}
			className="mx-auto h-auto max-w-full rounded-lg border border-fd-border"
			decoding="async"
			loading="lazy"
			src={src}
			style={{ width }}
		/>
		{caption ? (
			<figcaption className="mt-2 text-center text-fd-muted-foreground text-sm">
				{caption}
			</figcaption>
		) : null}
	</figure>
)
