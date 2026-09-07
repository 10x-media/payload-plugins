import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '설정 오버레이',
	[keys.appearanceLabel]: '화면 설정',
	[keys.back]: '뒤로',
	[keys.close]: '닫기',
	[keys.discardBody]: '저장하지 않은 변경 사항이 있습니다. 지금 나가면 삭제됩니다.',
	[keys.discardConfirm]: '변경 사항 버리기',
	[keys.discardHeading]: '변경 사항을 버릴까요?',
	[keys.empty]: '아직 표시할 항목이 없습니다.',
	[keys.loadFailed]: '불러오지 못했습니다. 다시 시도해 주세요.',
	[keys.noResults]: '일치하는 항목이 없습니다.',
	[keys.searchPlaceholder]: '검색',
	[keys.widgetNotice]: '이 위젯은 표시용이 아닙니다. 대시보드에서 제거할 수 있습니다.',
}
