import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.gridView]: '그리드로 보기',
	[keys.listView]: '목록으로 보기',
	[keys.orderLabel]: '순서',
	[keys.pickManyHint]:
		'{{modifier}} 키를 누른 채로 여러 개를, {{range}} 키를 누른 채로 범위를 선택하세요.',
	[keys.pluginName]: '폴더 선택기',
	[keys.retry]: '다시 시도',
	[keys.sortByLabel]: '정렬 기준',
}
