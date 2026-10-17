import { Upload } from 'tus-js-client'

export interface ClipUploaderOptions {
	file: Blob
	endpoint: string
	libraryId: string
	videoId: string
	signature: string
	expires: number
	onProgress: (sent: number, total: number) => void
}

/**
 * A thin wrapper over `tus-js-client`'s `Upload`, carrying the four headers
 * Bunny's video library needs on every request rather than leaving each
 * caller re-derive them, and none of the four is computed here: all of them
 * arrive verbatim from the `POST /api/clips` response.
 *
 * `chunkSize` is a tuning decision, not a protocol floor: 8 MB is roughly
 * three minutes of instant-mode video, which keeps the request count sane
 * without risking much of the upload on one dropped connection. `retryDelays`
 * is what turns that "much" into "one chunk": tus retries the request that
 * failed rather than the whole file.
 *
 * The upload begins after the recording stops, not while it is being made.
 * `file` is fixed at construction, so nothing reaches Bunny until the caller
 * (`captureRecording`) has already resolved with the finished `Blob`, a
 * five-minute clip has to leave the browser in one go once the person clicks
 * stop, so time-to-shareable is proportional to clip length rather than
 * constant. Closing that gap means giving this class a deferred-length
 * source (`uploadLengthDeferred`, fed from a stream instead of a `Blob`) and
 * confirming Bunny's TUS endpoint accepts one, unverified here, since doing
 * so needs live Bunny credentials nobody running this codebase has.
 */
export class ClipUploader {
	private readonly upload: Upload

	constructor(options: ClipUploaderOptions) {
		this.upload = new Upload(options.file, {
			endpoint: options.endpoint,
			headers: {
				AuthorizationSignature: options.signature,
				AuthorizationExpire: String(options.expires),
				VideoId: options.videoId,
				LibraryId: options.libraryId,
			},
			chunkSize: 8 * 1024 * 1024,
			retryDelays: [0, 3000, 10_000, 30_000],
			onProgress: options.onProgress,
		})
	}

	/** Begins the upload. Resolves once Bunny has every byte. */
	start = (): Promise<void> => this.runToCompletion()

	/**
	 * Halts the current attempt without telling Bunny to discard it, never
	 * `shouldTerminate`, which deletes the server-side upload and is only for
	 * a clip somebody actually cancelled, not a network blip. `resume()` picks
	 * up from wherever this left off.
	 */
	abort = (): Promise<void> => this.upload.abort()

	/** Continues an aborted upload from wherever Bunny last acknowledged. */
	resume = (): Promise<void> => this.runToCompletion()

	private readonly runToCompletion = (): Promise<void> =>
		new Promise((resolve, reject) => {
			this.upload.options.onSuccess = () => resolve()
			this.upload.options.onError = (error) => reject(error)
			this.upload.start()
		})
}
