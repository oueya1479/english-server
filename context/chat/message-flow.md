# 메시지 흐름

전체 메시지 전송에서 수신까지의 상세 플로우.

## 1. 클라이언트 -> 서버 (REST API)

### 엔드포인트

```
POST /api/v1/chat/send-message
Authorization: Bearer <JWT>
Content-Type: application/json
```

### 요청 DTO (`SendMessageDto`)

```typescript
{
  chat_room_id: string;  // UUID, 필수
  content: string;       // 메시지 내용, 필수, 최대 5000자
}
```

### 처리 과정 (`ChatService.processMessage`)

1. `chat_messages` 테이블에 사용자 메시지 INSERT (`sender_type: 'user'`)
2. `chat_rooms.last_message_at` 갱신
3. `processAiResponse()` fire-and-forget 호출 (비동기 백그라운드)
4. 즉시 `200 OK` 반환: `{ userMessage: {...} }`

> AI 처리는 백그라운드에서 진행되므로, 클라이언트는 메시지 저장 성공만 확인하고 바로 응답을 받는다.

---

## 2. 서버 내부 AI 파이프라인 (백그라운드)

`ChatService.processAiResponse()` -> `ChatService.processChatRoom()`

### 단계 1: Redis 분산 락 획득

```
키: chat_lock:{chatRoomId}
TTL: 60초
```

- 이미 다른 프로세스가 처리 중이면 (`acquired = false`) 조기 종료
- 같은 채팅방에서 동시에 여러 AI 처리가 실행되는 것을 방지

### 단계 2: 5초 디바운스 루프

```typescript
while (true) {
  await sleep(5000);
  // 마지막 사용자 메시지가 5초 이내이면 계속 대기
  // 5초 이상 지났으면 루프 탈출
}
```

- 사용자가 여러 메시지를 연속으로 보낼 때, 모든 메시지를 한 번에 처리하기 위한 디바운스
- 마지막 사용자 메시지의 `created_at`이 5초 이상 지나야 진행

### 단계 3: 미응답 사용자 메시지 수집

- 마지막 AI(teacher) 메시지의 `created_at` 이후 모든 사용자 메시지를 조회
- AI 메시지가 없으면 `1970-01-01` 기준 (전체 사용자 메시지)
- 여러 메시지를 `\n`으로 결합하여 하나의 컨텍스트로 전달

### 단계 4: 5개 병렬 데이터 패치

`Promise.all()`로 동시에 조회:

| 데이터 | 소스 | 설명 |
|--------|------|------|
| teacher | Redis 캐시 (1시간) -> Supabase | 선생님 정보 (name, persona_prompt, emotional_range 등) |
| memory | `conversation_memories` | 대화 요약, 사실/감정 메모리, 학생 프로필 |
| relationship_state | `relationship_states` | 4축 감정, 관계 단계, 스트릭 등 |
| events | `relationship_events` | 최근 10개 관계 이벤트 |
| history | `chat_messages` | 최근 15개 메시지 (시간 역순) |

- `relationship_state`가 없으면 기본값으로 새로 INSERT

### 단계 5: 감정 처리 파이프라인

순서대로 실행:

1. **시간 효과 적용** (`RelationshipService.applyTimeEffects`): 부재 시간에 따른 감정 변화
2. **감정 분류** (`SentimentService.classifyUserMessage`): 마지막 사용자 메시지의 감정 6단계 분류
3. **감정 델타 적용** (`SentimentService.applyEmotionDelta`): 분류 결과에 따른 4축 수치 변화
4. **스트릭 갱신** (`RelationshipService.updateStreak`): 연속 출석일 계산

### 단계 6: 시스템 프롬프트 빌드

`ChatAiService.buildSystemPrompt()`로 10개 섹션 조합. 상세는 [AI 프롬프트 시스템](./ai-prompt-system.md) 참조.

### 단계 7: OpenAI 호출

```typescript
// 메시지 배열 구성
messages = [
  { role: 'system', content: systemPrompt },
  ...history15.map(m => ({ role: m.sender_type === 'user' ? 'user' : 'assistant', content: m.content })),
  { role: 'user', content: combinedUserContent }
];

// OpenAI 호출
response = await openai.chatCompletion(messages, {
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'chat_response',
      strict: true,
      schema: {
        type: 'object',
        properties: { messages: { type: 'array', items: { type: 'string' } } },
        required: ['messages'],
        additionalProperties: false
      }
    }
  }
});
```

- 모델: `gpt-4o-mini` (OpenAIService 기본값)
- Temperature: `0.85`
- Max tokens: `300`
- 응답 형식: Structured JSON (`{ "messages": ["msg1", "msg2", ...] }`)

### 단계 8: 응답 파싱

```typescript
// JSON 파싱 -> messages 배열 추출
// 빈 문자열 필터링
// 최대 5개까지 제한
// 파싱 실패 시 raw string을 단일 메시지로
// 결과가 빈 배열이면 ["흠..."] 폴백
```

### 단계 9: BullMQ 지연 작업 스케줄링

딜레이 계산 방식:

```
초기 딜레이: 1500ms ("생각 시간")
각 메시지 타이핑 시간: 글자 수 x 50ms (min 1000ms, max 5000ms)
메시지 간 갭: 1500ms (두 번째 메시지부터)
```

딜레이는 누적(cumulative) 방식 -- BullMQ의 `delay`는 잡 등록 시점 기준이므로:

| 메시지 | 누적 딜레이 계산 |
|--------|-----------------|
| 1번째 | 1500 + typing(msg1) |
| 2번째 | 이전 + 1500(gap) + typing(msg2) |
| 3번째 | 이전 + 1500(gap) + typing(msg3) |

예시 (3개 메시지: "ㅋㅋ 진짜?" / "나도 그런 적 있어" / "근데 영어로 뭐라고 해야 할지 모르겠더라"):

```
msg1: 1500 + max(1000, min(5000, 6*50)) = 1500 + 1000 = 2500ms
msg2: 2500 + 1500 + max(1000, min(5000, 10*50)) = 2500 + 1500 + 1000 = 5000ms
msg3: 5000 + 1500 + max(1000, min(5000, 19*50)) = 5000 + 1500 + 1000 = 7500ms
```

### 단계 10: 후속 처리 (병렬)

- **관계 이벤트 감지 & 저장** (`RelationshipService.detectEvents`)
- **관계 단계 전환 체크** (`RelationshipService.checkStageTransition`)
- **question_frequency 갱신**: 최근 AI 메시지 3개 연속 질문이면 -15, 아니면 +3
- **relationship_states 테이블 업데이트**: 모든 변경된 수치 저장
- **메모리 요약 트리거**: 총 메시지 - 요약된 메시지 >= 30이면 fire-and-forget 요약 실행

### 단계 11: 재귀 처리 (새 메시지 감지)

```typescript
// AI 처리 중 도착한 새 사용자 메시지 확인
const newer = await ... .gt('created_at', processedUntil);
if (newer?.length) {
  // 락 해제 -> 재획득 -> processChatRoom() 재귀 호출
}
```

---

## 3. 서버 -> 클라이언트 (Socket.IO + BullMQ)

### Socket.IO 이벤트 흐름

| 순서 | 이벤트 | 대상 | 시점 |
|------|--------|------|------|
| 1 | `typing_start` | `room:{chatRoomId}` | BullMQ 작업 스케줄링 직전 |
| 2 | `new_message` | `room:{chatRoomId}` | 각 BullMQ delayed job 실행 시 |
| 3 | `typing_stop` | `room:{chatRoomId}` | 마지막 메시지 전달 시 |
| 4 | `chat_room_updated` | `user:{userId}` | 매 메시지 전달 시 (채팅방 목록 갱신용) |

### BullMQ 워커 처리 (`ChatDeliveryProcessor`)

각 delayed job 실행 시:

1. Redis `active_room:{userId}`로 사용자 인룸 여부 체크
2. `chat_messages`에 AI 메시지 INSERT (`is_read` = 사용자 인룸 여부)
3. `chat_rooms` 갱신 (`last_message_at`, 인룸이면 `user_unread_count = 0`)
4. Socket.IO `new_message` emit
5. 마지막 메시지이면: `typing_stop` emit + Redis `typing:{chatRoomId}` 키 삭제
6. 첫 메시지 + 유저 미접속이면: FCM 푸시 발송 (100자 초과 시 97자 + "...")
7. `chat_room_updated` emit (유저 개인 채널)

---

## 4. 시퀀스 다이어그램

```
Client              REST API           Background Worker        BullMQ Worker
  |                    |                      |                      |
  |--POST /send-msg--->|                      |                      |
  |                    |--INSERT user msg      |                      |
  |<--{ userMessage }--|                      |                      |
  |                    |--fire & forget------->|                      |
  |                    |                      |--Redis lock           |
  |                    |                      |--5s debounce          |
  |                    |                      |--fetch context (5x)   |
  |                    |                      |--sentiment classify   |
  |                    |                      |--build prompt         |
  |                    |                      |--OpenAI call          |
  |                    |                      |--parse JSON           |
  |<==typing_start(WS)========================|                      |
  |                    |                      |--schedule BullMQ jobs |
  |                    |                      |                      |
  |                    |                      |     (delay 2.5s~)     |
  |<==new_message(WS)===================================================|
  |                    |                      |     (delay +gap+typ)  |
  |<==new_message(WS)===================================================|
  |<==typing_stop(WS)===================================================|
  |                    |                      |                      |
  |<--FCM push (if offline)=============================================|
```

---

## 5. 에러 처리

| 시점 | 에러 | 처리 |
|------|------|------|
| 메시지 저장 실패 | Supabase INSERT 에러 | throw Error -> 500 응답 |
| 락 획득 실패 | 이미 처리 중 | 조기 종료 (로그만) |
| OpenAI 호출 실패 | API 에러 | 폴백 메시지: "아 잠깐, 다시 한번 말해줄래?" |
| JSON 파싱 실패 | 비정상 응답 | raw string을 단일 메시지로 사용 |
| 메시지 배열 비어있음 | 필터 후 빈 배열 | ["흠..."] 폴백 |
| BullMQ 전달 실패 | DB INSERT 에러 | 에러 throw (BullMQ 자체 재시도) |
| FCM 발송 실패 | FCM 에러 | 로그 경고만 (메시지 전달에 영향 없음) |
| 메모리 요약 실패 | OpenAI/DB 에러 | 로그 에러만 (fire-and-forget) |
