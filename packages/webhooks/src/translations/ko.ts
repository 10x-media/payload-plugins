import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: '구독',
	[keys.subscriptionPlural]: '구독',
	[keys.deliverySingular]: '전송',
	[keys.deliveryPlural]: '전송 내역',
	[keys.fieldName]: '이름',
	[keys.fieldUrl]: '엔드포인트 URL',
	[keys.fieldEnabled]: '활성화됨',
	[keys.fieldEvents]: '이벤트',
	[keys.fieldSecret]: '서명 시크릿',
	[keys.fieldSecretHelp]:
		'생성할 때 한 번만 전체가 표시되고 이후에는 가려집니다. 전송에 서명할 때 쓰이니 지금 수신 측에 복사해 두세요.',
	[keys.fieldHeaders]: '사용자 정의 헤더',
	[keys.fieldDescription]: '설명',
	[keys.statusPending]: '대기 중',
	[keys.statusSuccess]: '전송됨',
	[keys.statusFailed]: '실패',
	[keys.statusDead]: '중단됨',
	[keys.redeliver]: '다시 전송',
	[keys.redeliverDone]: '재전송이 대기열에 추가되었습니다',
}
