# 안티패턴 시스템

AI가 매번 비슷한 패턴으로 응답하는 것을 방지하는 랜덤화 시스템. 매 호출마다 `Math.random()`으로 다양한 스타일을 강제한다.
구현 파일: `src/chat/anti-pattern.service.ts`

---

## 목적

AI 챗봇의 대표적 문제점:
- 매번 질문으로 끝나는 응답
- 비슷한 길이의 응답
- 동일한 톤과 스타일

이를 방지하기 위해 **매 호출마다 3가지 축을 랜덤화**하여 시스템 프롬프트에 지시문을 추가한다.

---

## 3가지 랜덤화 축

### (a) 질문 빈도 제어

관계 단계별 질문 확률 상한:

| 단계 | 최대 빈도 (cap) |
|------|-----------------|
| `stranger` | 70% |
| `acquaintance` | 60% |
| `comfortable` | 50% |
| `close_friend` | 40% |
| `best_friend` | 30% |

```typescript
const cap = maxQuestionFreq[state.stage] || 50;
const shouldAskQuestion = Math.random() * 100 < Math.min(state.question_frequency, cap);
```

- `state.question_frequency` (기본 60, 범위 10~100)와 단계별 cap 중 작은 값을 확률로 사용
- 친해질수록 질문 빈도가 자연스럽게 줄어든다

**false일 때 지시문**:
```
DO NOT ask a question in this message. Just react, comment, or share.
```

### (b) 응답 길이 랜덤화

| 확률 | 지시문 |
|------|--------|
| 25% (< 0.25) | "Keep this response VERY short: just 1-5 words. A quick reaction like 'ㅋㅋ 진짜?', 'oh nice', '헐', 'lol same', '아 그랬구나'." |
| 25% (0.25~0.50) | "Keep this response to ONE sentence max." |
| 35% (0.50~0.85) | "Normal length: 1-2 sentences." |
| 15% (0.85~1.00) | "You can write a bit more than usual IF you genuinely have something to say. 2-3 sentences max." |

> 25%의 확률로 극도로 짧은 응답이 강제되어 AI 특유의 "항상 2-3문장" 패턴을 깨뜨린다.

### (c) 스타일 랜덤화

| 확률 | 지시문 |
|------|--------|
| 10% (< 0.1) | "Style hint: just react with emoji or ㅋㅋ/ㅎㅎ type reaction. No real content needed." |
| 10% (0.1~0.2) | "Style hint: instead of responding directly, share a brief related personal experience or opinion." |
| 10% (0.2~0.3) | "Style hint: lightly tease or playfully disagree with what the student said." |
| 10% (0.3~0.4) | "Style hint: naturally shift the topic to something related but new." |
| 60% (0.4~1.0) | (별도 스타일 지시 없음) |

> 40%의 확률로 특수 스타일이 적용되어 응답의 다양성을 확보한다.

---

## question_frequency 피드백 루프

`ChatService.processChatRoom()`의 14단계에서 갱신:

```typescript
if (historyMessages.length >= 3) {
  const recentAiMsgs = historyMessages
    .filter(m => m.sender_type === 'teacher')
    .slice(0, 3);

  const allHadQuestions = recentAiMsgs.every(
    m => m.content && /[?\uff1f]/.test(m.content)  // ? 또는 ？
  );

  if (allHadQuestions) {
    question_frequency -= 15;  // 질문 과다 -> 빈도 대폭 감소
  } else {
    question_frequency += 3;   // 정상 -> 서서히 회복
  }

  // 범위: 10 ~ 100
  question_frequency = clamp(question_frequency, 10, 100);
}
```

### 피드백 루프 동작 원리

1. 최근 AI 메시지 3개를 확인
2. 3개 모두 `?` 또는 `？`를 포함하면: `question_frequency -15`
3. 아니면: `question_frequency +3`
4. 범위: 10 ~ 100

**효과**: AI가 연속으로 질문하면 다음 호출에서 질문 확률이 급감한다. 질문하지 않으면 서서히 회복.

---

## 출력 형식

`AntiPatternService.getAntiPatternDirective()` 반환값:

```
## Response Style for THIS Message
DO NOT ask a question in this message. Just react, comment, or share.
Keep this response VERY short: just 1-5 words. A quick reaction like "ㅋㅋ 진짜?", "oh nice", "헐", "lol same", "아 그랬구나".
Style hint: lightly tease or playfully disagree with what the student said.
```

이 지시문은 시스템 프롬프트의 9번째 섹션으로 삽입된다. 상세는 [AI 프롬프트 시스템](./ai-prompt-system.md) 참조.

---

## 예시 시나리오

### 시나리오 1: close_friend 단계, question_frequency 45

```
cap = 40 (close_friend)
effective_freq = min(45, 40) = 40
질문 확률: 40%

길이 주사위: 0.72 -> "Normal length: 1-2 sentences."
스타일 주사위: 0.15 -> "share a brief related personal experience"
```

### 시나리오 2: stranger 단계, question_frequency 60, 3연속 질문 후

```
question_frequency: 60 - 15 = 45 (피드백 루프)
cap = 70 (stranger)
effective_freq = min(45, 70) = 45
질문 확률: 45%

길이 주사위: 0.10 -> "VERY short: just 1-5 words"
스타일 주사위: 0.55 -> (별도 지시 없음)
```
