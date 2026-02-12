# 감정 분류 시스템

사용자 메시지의 감정을 규칙 기반 정규식 패턴 매칭으로 분류하는 시스템. AI를 사용하지 않으며, 지연 없이 즉시 분류한다.
구현 파일: `src/chat/sentiment.service.ts`

---

## 분류 유형

6가지 감정 유형 (`MessageSentiment` 타입):

```typescript
type MessageSentiment =
  | 'rude'           // 무례
  | 'dismissive'     // 무성의 (단답)
  | 'positive'       // 긍정
  | 'english_effort' // 영어 노력
  | 'personal_share' // 개인적 이야기 공유
  | 'neutral';       // 중립 (기본값)
```

---

## 분류 우선순위

위에서 아래 순서로 매칭. 먼저 매칭되는 분류가 최종 결과.

### 1순위: rude (무례)

한국어/영어 욕설 및 공격적 표현 18개 패턴:

| # | 패턴 | 설명 |
|---|------|------|
| 1 | `/[씨시]발/` | 씨발/시발 |
| 2 | `/[ㅅㅆ][ㅂ]/` | ㅅㅂ/ㅆㅂ (초성 욕설) |
| 3 | `/병신/` | 병신 |
| 4 | `/꺼져/` | 꺼져 |
| 5 | `/닥[쳐쵸]/` | 닥쳐/닥쵸 |
| 6 | `/미친/` | 미친 |
| 7 | `/[ㅈ]같/` | ㅈ같 |
| 8 | `/개[새세]끼/` | 개새끼/개세끼 |
| 9 | `/바보/` | 바보 |
| 10 | `/멍청/` | 멍청 |
| 11 | `/fuck/i` | fuck (대소문자 무시) |
| 12 | `/shit/i` | shit |
| 13 | `/stupid/i` | stupid |
| 14 | `/shut\s*up/i` | shut up |
| 15 | `/idiot/i` | idiot |
| 16 | `/dumb/i` | dumb |
| 17 | `/hate\s*you/i` | hate you |
| 18 | `/go\s*away/i` | go away |

### 2순위: dismissive (무성의)

단답형/무성의 응답 8개 패턴:

| # | 패턴 | 설명 |
|---|------|------|
| 1 | `/^[ㅇㅎㄴㄱㅋㅎ]{1,4}$/` | 초성 1~4자 (ㅇㅋ, ㅎㅎ 등) |
| 2 | `/^(ㅇㅇ\|ㄴㄴ\|ㄱㄱ\|ㅇㅋ\|ㅎㅎ\|ㅋㅋ)$/` | 특정 초성 조합 |
| 3 | `/^(네\|응\|ㅇ\|어\|ok\|no\|yeah\|nah\|sure\|k\|idk)$/i` | 단답 응답 |
| 4 | `/^싫[어다]?$/` | 싫어/싫다 |
| 5 | `/^됐[어다]?$/` | 됐어/됐다 |
| 6 | `/^몰[라라]?$/` | 몰라 |
| 7 | `/^귀찮/` | 귀찮~ |
| 8 | `/^재미없/` | 재미없~ |

> dismissive 패턴 대부분은 `^...$` (전체 매칭)이므로, 긴 메시지 안의 "응"은 매칭되지 않는다.

### 3순위: positive (긍정)

긍정적 반응 17개 패턴:

| # | 패턴 | 설명 |
|---|------|------|
| 1 | `/고마[워웠]/` | 고마워/고마웠 |
| 2 | `/감사/` | 감사 |
| 3 | `/ㅋㅋㅋ+/` | ㅋ 3개 이상 |
| 4 | `/ㅎㅎㅎ+/` | ㅎ 3개 이상 |
| 5 | `/재[밌미]/` | 재밌/재미 |
| 6 | `/좋[아았]/` | 좋아/좋았 |
| 7 | `/최고/` | 최고 |
| 8 | `/thank/i` | thank |
| 9 | `/awesome/i` | awesome |
| 10 | `/great/i` | great |
| 11 | `/love\s*(it\|this\|that)/i` | love it/this/that |
| 12 | `/haha/i` | haha |
| 13 | `/lol/i` | lol |
| 14 | `/nice/i` | nice |
| 15 | `/cool/i` | cool |
| 16 | `/amazing/i` | amazing |
| 17 | `/helpful/i` | helpful |
| 18 | `/fun/i` | fun |

> 참고: "ㅋㅋ" (2개)는 dismissive로 분류되고, "ㅋㅋㅋ" (3개 이상)은 positive로 분류된다.

### 4순위: english_effort (영어 노력)

```typescript
if (trimmed.length > 5) {
  const englishChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (englishChars / totalChars > 0.4) return 'english_effort';
}
```

- 조건: 5자 초과 메시지 AND 영문 비율 > 40%
- 영어를 사용하려는 노력을 인정

### 5순위: personal_share (개인적 공유)

```typescript
if (trimmed.length > 60) return 'personal_share';
```

- 조건: 60자 초과 긴 메시지
- 개인적인 이야기나 깊은 대화로 간주

### 6순위: neutral (중립)

- 위의 어떤 패턴에도 매칭되지 않을 때 기본값

---

## 감정 델타 매핑

`SentimentService.applyEmotionDelta()` -- 분류 결과에 따른 `RelationshipState` 수치 변화.

| Sentiment | warmth | patience | enthusiasm | trust | consecutive_positive | consecutive_negative | rude_count |
|-----------|--------|----------|------------|-------|---------------------|---------------------|------------|
| `rude` | -8 | -12 | - | -6 | = 0 | +1 | +1 |
| `dismissive` | - | -5 | -4 | - | = 0 | +1 | - |
| `positive` | +3 | - | +4 | - | +1 | = 0 | - |
| `english_effort` | - | - | +5 | +2 | +1 | = 0 | - |
| `personal_share` | +1 | - | - | +2 | +1 | = 0 | - |
| `neutral` | - | +1 | - | - | - | = 0 | - |

> `-`는 변화 없음. `= 0`은 해당 카운터를 0으로 리셋.

### 주요 특성

- **rude**가 가장 큰 부정적 영향 (3개 축 동시 하락)
- **trust**는 `english_effort`와 `personal_share`에서만 증가 (+2씩) -- 느리게 쌓이는 설계
- **patience**는 `neutral`에서도 +1 회복 -- 평범한 대화도 인내심 회복에 기여
- **consecutive** 카운터는 연속성을 추적하여 [안티패턴 시스템](./anti-pattern-system.md)과 [AI 프롬프트](./ai-prompt-system.md)에서 활용
