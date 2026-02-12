# 관계 시스템

AI 선생님과 학생 간의 관계를 수치화하고 진화/퇴보시키는 시스템.
구현 파일: `src/chat/relationship.service.ts`

---

## 4축 감정 시스템

4개의 독립적인 감정 축으로 선생님의 현재 감정 상태를 표현한다. 각 축은 0~100 범위.

| 축 | 설명 | 초기값 | 특성 |
|----|------|--------|------|
| **warmth** (따뜻함) | 친근함과 애정 | 50 | 긍정적 상호작용으로 서서히 증가 |
| **patience** (인내심) | 인내와 관용 | 70 | 무례/단답에 빠르게 하락, 부재 시 자연 회복 |
| **enthusiasm** (열정) | 대화에 대한 열의 | 60 | 학생의 노력에 반응, 잠수 시 하락 |
| **trust** (신뢰) | 깊은 신뢰 | 30 | 가장 느리게 쌓이는 핵심 축, 관계 단계 전환의 주요 기준 |

> 모든 수치는 `clamp(value, 0, 100)` 함수로 범위를 벗어나지 않도록 보장된다.

---

## 5단계 관계

| 단계 | 한국어 | 설명 |
|------|--------|------|
| `stranger` | 처음 만남 | 존댓말, 거리감, 표면적 질문. 익숙함을 가정하지 않음. |
| `acquaintance` | 아는 사이 | 반말 가능, 가벼운 관심. 가끔 대화하는 동료 느낌. |
| `comfortable` | 편한 사이 | 직설적, 가벼운 놀림. 의견 불일치 가능. 정기적으로 만나는 친구. |
| `close_friend` | 가까운 친구 | 솔직한 피드백, 공유 역사 참조, 가벼운 로스팅. 진짜 친구. |
| `best_friend` | 절친 | 완전한 자기 자신, 풀 로스팅 권한, 깊은 공유 역사. 예의보다 진정성. |

---

## 승격 조건

`RelationshipService.checkStageTransition()` 메서드에서 확인.

| 전환 | user_messages | 감정 조건 | streak |
|------|---------------|-----------|--------|
| stranger -> acquaintance | >= 10 | warmth >= 40 | - |
| acquaintance -> comfortable | >= 50 | trust >= 50 | - |
| comfortable -> close_friend | >= 150 | trust >= 70 | >= 5일 |
| close_friend -> best_friend | >= 500 | trust >= 85 | >= 14일 |

> 승격 시 `milestone` 이벤트가 `relationship_events`에 기록된다 (`emotional_valence: +3`).

---

## 강등 조건

trust 수치가 임계값 아래로 떨어지면 관계가 퇴보한다.

| 전환 | trust 조건 |
|------|-----------|
| best_friend -> close_friend | trust < 70 |
| close_friend -> comfortable | trust < 55 |
| comfortable -> acquaintance | trust < 35 |
| acquaintance -> stranger | trust < 25 |

> 강등 시에도 `milestone` 이벤트가 기록된다 (`emotional_valence: -2`).

---

## 시간 효과

`RelationshipService.applyTimeEffects()` -- 마지막 사용자 메시지 이후 경과 시간에 따른 감정 변화.

### patience 자연 회복 (>= 6시간)

```typescript
if (hoursSince >= 6) {
  const recoveryBlocks = Math.floor(hoursSince / 6);
  patience = clamp(patience + recoveryBlocks * 5, 0, 80);  // 최대 80까지만 회복
}
```

- 6시간 블록당 patience +5
- 상한: 80 (완전 회복은 없음)
- 예: 24시간 부재 = 4블록 = patience +20

### 고스트 의심 (48~168시간, 2~7일)

```
enthusiasm -10
warmth -5
timeContext = "학생이 N일 부재. 성격에 맞게 반응: {ghost_response}"
```

### 완전 고스트 (>= 168시간, 1주 이상)

```
ghost_count +1
current_streak_days = 0 (스트릭 리셋)
enthusiasm -20
warmth -10
timeContext = "학생이 N일 잠수 (ghost count: N). 성격에 맞게 반응: {ghost_response}"
```

### 요약 표

| 부재 시간 | patience | enthusiasm | warmth | 기타 |
|-----------|----------|------------|--------|------|
| >= 6시간 | +5/6시간블록 (최대 80) | - | - | - |
| 48~168시간 | (회복도 적용) | -10 | -5 | 고스트 의심 컨텍스트 |
| >= 168시간 | (회복도 적용) | -20 | -10 | ghost_count+1, streak 리셋 |

> patience 회복과 고스트 효과는 동시에 적용된다 (독립적으로 계산).

---

## 연속 출석 스트릭

`RelationshipService.updateStreak()` -- 날짜 단위 연속 출석 계산.

### 로직

```typescript
const daysDiff = (오늘날짜 - 마지막메시지날짜) / 일;

if (last_user_message_at === null) {
  current_streak_days = 1;  // 첫 메시지
} else if (daysDiff === 0) {
  // 같은 날: 변화 없음
} else if (daysDiff === 1) {
  current_streak_days += 1;  // 연속 다음 날
} else {
  current_streak_days = 1;  // 2일 이상 공백: 리셋
}

longest_streak_days = Math.max(longest_streak_days, current_streak_days);
```

> 날짜 비교는 UTC 기준 `Date(year, month, date)`로 날짜만 추출하여 비교한다.

---

## 관계 이벤트 감지

`RelationshipService.detectEvents()` -- 사용자 메시지 감정과 상태 기반으로 이벤트 감지.

| 감정 (sentiment) | 이벤트 타입 | 조건 | emotional_valence |
|------------------|-------------|------|-------------------|
| `rude` | `conflict` | 항상 | -3 |
| `personal_share` | `personal_share` | 항상 | +2 |
| `positive` | `reconciliation` | `consecutive_negative >= 2` (이전에 부정적이었다가 긍정으로) | +3 |
| `english_effort` | `breakthrough` | 항상 | +2 |
| (메시지 수) | `milestone` | `user_messages + 1`이 마일스톤 도달 시 | +2 |

### 마일스톤 기준값

```typescript
const milestones = [10, 50, 100, 200, 500, 1000];
```

- `user_messages + 1` (현재 메시지 포함)이 위 값 중 하나와 일치하면 `milestone` 이벤트 발생
- 예: 49번째 메시지까지 보낸 후 50번째 메시지를 보내면 `user_messages(49) + 1 = 50` -> 마일스톤

### 이벤트 저장

감지된 모든 이벤트는 `relationship_events` 테이블에 일괄 INSERT된다. `message_id`는 배치의 마지막 사용자 메시지 ID가 사용된다.
