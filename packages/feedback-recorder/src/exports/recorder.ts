'use client'

export { AUDIO_BITS_PER_SECOND, type ClipMode, videoBitsPerSecond } from '../recorder/bitrate'
export {
	type BubbleLayout,
	clampBubble,
	DEFAULT_BUBBLE,
	MAX_RADIUS,
	MIN_RADIUS,
} from '../recorder/bubbleLayout'
export { ClipUploader, type ClipUploaderOptions } from '../recorder/ClipUploader'
export { canCompositeCamera } from '../recorder/cameraOverlay'
export { meterWidth, rmsLevel } from '../recorder/micLevel'
export type {
	BunnyUploadTarget,
	ClipTransport,
	ReservedClip,
	ReserveInput,
} from '../recorder/transport'
export { estimateUploadMinutes } from '../recorder/uploadEstimate'
export {
	type ClipRecorderError,
	type ClipRecorderProgress,
	type ClipRecorderState,
	type HeldRecording,
	type UseClipRecorderOptions,
	type UseClipRecorderResult,
	useClipRecorder,
} from '../recorder/useClipRecorder'
