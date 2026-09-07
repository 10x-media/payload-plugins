import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '설정 오버레이',
	[keys.appearanceLabel]: '화면 설정',
	[keys.back]: '뒤로',
	[keys.close]: '닫기',
	[keys.delete]: '삭제',
	[keys.deleteBody]: '이 문서는 영구적으로 삭제됩니다. 되돌릴 수 없습니다.',
	[keys.deleteConfirm]: '삭제',
	[keys.deleteHeading]: '문서를 삭제할까요?',
	[keys.deleted]: '문서를 삭제했습니다',
	[keys.discardBody]: '저장하지 않은 변경 사항이 있습니다. 지금 나가면 삭제됩니다.',
	[keys.discardConfirm]: '변경 사항 버리기',
	[keys.discardHeading]: '변경 사항을 버릴까요?',
	[keys.empty]: '아직 표시할 항목이 없습니다.',
	[keys.loadFailed]: '불러오지 못했습니다. 다시 시도해 주세요.',
	[keys.noResults]: '일치하는 항목이 없습니다.',
	[keys.searchPlaceholder]: '검색',
}
