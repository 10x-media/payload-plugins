import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.undo]: '실행 취소',
	[keys.redo]: '다시 실행',
	[keys.debug]: '실행 취소 기록',
	[keys.debugTooltip]: '실행 취소 기록 살펴보기',
	[keys.debugTitle]: '실행 취소 기록',
	[keys.debugEmpty]: '아직 기록된 내역이 없습니다.',
	[keys.debugClose]: '닫기',
	[keys.debugPending]: '대기 중 (기록되지 않음)',
	[keys.debugOriginal]: '원래 상태',
	[keys.debugCopy]: 'JSON 복사',
}
