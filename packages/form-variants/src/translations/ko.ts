import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.back]: '뒤로',
	[keys.done]: '완료',
	[keys.next]: '다음',
	[keys.noVariants]: '이 컬렉션에서 사용할 수 있는 양식이 없습니다.',
	[keys.pluginName]: '양식 변형',
	[keys.progress]: '단계',
	[keys.readOnly]: '이 문서는 읽기 전용입니다.',
	[keys.stepCompleted]: '완료됨',
	[keys.stepInvalid]: '계속하려면 표시된 필드를 수정하세요.',
	[keys.switcherLabel]: '양식',
}
