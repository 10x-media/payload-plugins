import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: '중복',
	[keys.queueTitle]: '중복 문서',
	[keys.collection]: '컬렉션',
	[keys.statusOpen]: '열림',
	[keys.statusDismissed]: '중복 아님',
	[keys.noPairs]: '검토할 항목이 없습니다.',
	[keys.noCollections]: '중복 검사가 설정된 컬렉션이 없습니다.',
	[keys.dismiss]: '중복 아님',
	[keys.reopen]: '다시 열기',
	[keys.mergeInto]: '{{title}}(으)로 병합',
	[keys.runScan]: '지금 검사',
	[keys.scanQueued]: '검사가 대기열에 추가되었습니다.',
	[keys.scanDone]: '검사 완료: {{compared}}건 비교 중 열린 쌍 {{pairs}}건.',
	[keys.needsChoice]: '선택 필요',
	[keys.applied]: '기본 문서로 병합되었습니다.',
	[keys.empty]: '비어 있음',
	[keys.selectTwo]: '병합할 문서를 2개에서 {{max}}개까지 선택하세요.',
	[keys.mergeSelected]: '선택 항목 병합',
	[keys.noTransactions]:
		'이 데이터베이스는 트랜잭션을 열지 않습니다. 병합이 도중에 실패하면 이미 끝난 단계는 그대로 남습니다: 병합된 문서의 자리표시 값, 옮겨진 참조, 기본 문서의 일부 언어. 병합 기록은 실패로 표시되고 옮겨진 항목을 나열합니다.',
	[keys.transactionsRequired]:
		'병합이 꺼져 있습니다: 이 데이터베이스는 트랜잭션을 열지 않으며 플러그인은 트랜잭션을 요구하도록 설정되어 있습니다.',
	[keys.takenFrom]: '{{title}}에서 가져옴',
	[keys.error]: '문제가 발생했습니다.',
	[keys.missingParams]: '병합 화면에는 컬렉션과 문서 ID 두 개가 필요합니다.',
	[keys.confirmHeading]: '이 병합을 적용할까요?',
	[keys.confirmBody]: '{{absorbed}}이(가) {{survivor}}(으)로 병합되어 컬렉션에서 제거됩니다.',
	[keys.primary]: '기본 · ID 유지',
	[keys.makePrimary]: '기본으로 지정',
	[keys.created]: '생성',
	[keys.updated]: '수정',
	[keys.onlyDifferences]: '차이만',
	[keys.showDiff]: '차이 강조',
	[keys.mergeCount]: '문서 {{count}}개 병합',
	[keys.releaseMarked]:
		'{{survivor}}이(가) {{fields}} 값을 가져가고 이 값은 한 문서만 가질 수 있으므로, {{title}}은(는) 해당 필드에 자리 표시 값을 넣은 채 휴지통으로 이동합니다.',
	[keys.releaseEmptied]:
		'{{survivor}}이(가) {{fields}} 값을 가져가고 이 값은 한 문서만 가질 수 있으므로, {{title}}은(는) 해당 필드를 비운 채 휴지통으로 이동합니다.',
	[keys.pointersCleared]:
		'{{fields}}에서 이 병합의 문서를 가리키는 링크는 제거됩니다. 병합 후에는 사라진 문서나 {{survivor}} 자신을 가리키게 되기 때문입니다.',
	[keys.survivorDraft]:
		'{{title}}에 게시되지 않은 변경 사항이 있으며 병합하면 게시됩니다. 먼저 게시하거나 취소하세요.',
	[keys.mayNotApply]: '권한이 없어 이 병합을 적용할 수 없습니다.',
	[keys.releaseDeletes]:
		'{{survivor}}이(가) {{fields}} 값을 가져가고 이 값은 한 문서만 가질 수 있으므로, {{title}}은(는) 휴지통으로 이동하지 않고 삭제됩니다.',
	[keys.signals]: '비슷한 이유',
	[keys.takeAll]: '모든 값 유지',
	[keys.similarity]: '유사도',
	[keys.whySame]: '같음: {{fields}}',
	[keys.whySimilar]: '비슷함: {{fields}}',
	[keys.whyDiffer]: '다름: {{fields}}',
	[keys.whyVeto]: '{{fields}} 때문에 제외',
	[keys.markedBy]: '표시한 사람',
	[keys.aboutOpen]:
		'검토를 기다리는 비슷한 문서입니다. 그룹마다 한 줄로 표시됩니다. 열어서 병합하거나 중복이 아님으로 표시하세요.',
	[keys.aboutDismissed]:
		'중복이 아님으로 표시된 문서입니다. 그룹마다 한 줄로 표시됩니다. 이후 스캔에서도 여기에 남으며, 열어서 다시 열 수 있습니다.',
	[keys.markedNotDuplicates]: '중복이 아님으로 표시했습니다.',
	[keys.dismissedNote]: '{{user}}님이 {{date}}에 중복이 아님으로 표시했습니다.',
	[keys.markedApart]:
		'{{user}}님이 {{date}}에 {{a}}와 {{b}}를 중복이 아님으로 표시했습니다. 병합하면 이 표시는 무시됩니다.',
	[keys.removeFromMerge]: '이 병합에서 제외',
	[keys.removeHeading]: '이 병합에서 {{title}}을(를) 제외할까요?',
	[keys.removeBody]: '문서 자체는 바뀌지 않습니다. 이 화면에서 이 문서로부터 고른 값은 취소됩니다.',
	[keys.andMore]: '{{title}} 외 {{count}}개',
}
