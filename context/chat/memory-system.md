# 3레이어 메모리 시스템

AI 선생님이 학생과의 대화 내용을 장기적으로 기억하기 위한 증분 요약 시스템.
구현 파일: `src/chat/memory.service.ts`

---

## 트리거 조건

```typescript
// ChatService.processChatRoom() 마지막 단계에서 체크
const totalMessages = await getMessageCount(chatRoomId);
const summarizedCount = memory?.messages_summarized || 0;
if (totalMessages - summarizedCount >= 30) {
  this.memoryService.summarizeConversation(chatRoomId, memory)
    .catch(err => this.logger.error(`Summarization failed: ${err}`));
}
```

- **조건**: 총 메시지 수 - 요약 완료된 메시지 수 >= 30
- **실행 방식**: fire-and-forget (비동기, 에러가 메인 플로우에 영향 없음)
- **빈도**: AI 응답 처리 완료 후 매번 체크

---

## 3개 레이어

### 1. Factual Memory (사실 기억)

학생에 대해 파악한 객관적 사실.

**포함 내용**:
- 학생 이름, 직업, 나이
- 관심사, 취미
- 영어 레벨, 자주 하는 실수
- 학습 목표
- 생활 패턴, 주요 이력

**형식**: Bullet point 목록, 최대 10개

**프롬프트 활용**: 시스템 프롬프트의 `"What you know about this student"` 섹션

### 2. Emotional Memory (감정 기억)

선생님 관점에서 관계에 대한 감정적 회고.

**핵심 원칙**: 보고서가 아닌, **사람이 느끼는 감정**으로 작성.

```
# 좋은 예 (감정적 회고)
"이 학생이랑 처음엔 좀 어색했는데, 요즘은 대화할 때 편해졌다.
 영어 잘하려고 노력하는 게 보여서 좀 뿌듯하기도 하고."

# 나쁜 예 (보고서 형식)
"학생과의 관계는 comfortable 단계이며, trust 수치는 58입니다."
```

**형식**: 2-3문장 산문

**프롬프트 활용**: 시스템 프롬프트의 `"How you feel about this relationship"` 섹션

### 3. Student Profile (학생 프로필)

구조화된 JSON 정보.

```json
{
  "english_level": "beginner" | "intermediate" | "advanced",
  "interests": ["K-pop", "travel", "gaming"],
  "communication_style": "casual and friendly",
  "learning_preference": "conversation-based"
}
```

**프롬프트 활용**: 현재 직접 프롬프트에 포함되지는 않으나, `conversation_memories` 테이블에 저장되어 향후 활용 가능.

---

## 요약 프로세스

`MemoryService.summarizeConversation()` 전체 흐름:

### 단계 1: 새 메시지 조회

```typescript
let query = supabase.from('chat_messages')
  .select('id, sender_type, content, created_at')
  .eq('chat_room_id', chatRoomId)
  .order('created_at', { ascending: true });

// 증분 처리: 마지막 요약 이후 메시지만
if (existingMemory?.last_summarized_message_id) {
  const lastMsg = await ... // 마지막 요약 메시지의 created_at 조회
  query = query.gt('created_at', lastMsg.created_at);
}
```

### 단계 2: OpenAI 요약 요청

**프롬프트 구성**:

```
You are a memory system for an AI English teacher.
Analyze the conversation and produce output in EXACTLY this format:

===FACTUAL===
(Bullet points of factual info about the student...)

===EMOTIONAL===
(Write as the teacher reflecting on this relationship...)

===PROFILE===
(JSON object with: {"english_level": "...", "interests": [...], ...})

Previous factual memory:
{기존 factual_memory}

Previous emotional memory:
{기존 emotional_memory}

Previous summary:
{기존 summary}

New messages to incorporate:
user: 안녕하세요!
teacher: 반갑습니다!
user: 오늘 영어 공부하고 싶어요
...
```

**OpenAI 파라미터**:
- Temperature: `0.3` (일관성 중시)
- Max tokens: `600`
- 모델: `gpt-4o-mini` (OpenAIService 기본값)

### 단계 3: 응답 파싱

정규식으로 3개 섹션을 추출:

```typescript
const factualMatch = response.match(/===FACTUAL===\s*([\s\S]*?)(?====EMOTIONAL===|$)/);
const emotionalMatch = response.match(/===EMOTIONAL===\s*([\s\S]*?)(?====PROFILE===|$)/);
const profileMatch = response.match(/===PROFILE===\s*([\s\S]*?)$/);
```

- `===FACTUAL===` 섹션 -> `factual_memory`
- `===EMOTIONAL===` 섹션 -> `emotional_memory`
- `===PROFILE===` 섹션 -> JSON 파싱 -> `student_profile`
- JSON 파싱 실패 시 기존 프로필 유지

### 단계 4: DB UPSERT

```typescript
await supabase.from('conversation_memories').upsert({
  chat_room_id: chatRoomId,
  summary: summaryResponse,               // OpenAI 응답 전체 원문
  factual_memory: factualMemory,           // 파싱된 사실 기억
  emotional_memory: emotionalMemory,       // 파싱된 감정 기억
  student_profile: studentProfile,         // 파싱된 학생 프로필 JSON
  messages_summarized: totalCount,         // 현재 총 메시지 수
  last_summarized_message_id: lastMessageId, // 마지막 요약 메시지 ID
  updated_at: new Date().toISOString(),
}, { onConflict: 'chat_room_id' });
```

- `onConflict: 'chat_room_id'` -- 이미 존재하면 UPDATE, 없으면 INSERT

---

## 증분 방식의 장점

```
[요약 시점 1]
  기존 메모리: 없음
  새 메시지: #1 ~ #30
  결과: factual/emotional/profile 생성
  마커: last_summarized_message_id = #30

[요약 시점 2]
  기존 메모리: 시점 1의 결과
  새 메시지: #31 ~ #60 (30개만 읽음)
  결과: 기존 메모리 + 새 메시지 = 업데이트된 메모리
  마커: last_summarized_message_id = #60
```

- 매번 전체 대화를 재요약하지 않음
- 기존 메모리 + 새 메시지만으로 업데이트
- `last_summarized_message_id` 북마크로 증분 처리
- 토큰 비용과 지연 시간 절감

---

## 프롬프트 내 활용

`ChatAiService.getMemoryBlock()`에서 시스템 프롬프트에 포함:

```typescript
// factual_memory가 있으면
"### What you know about this student\n{factual_memory}"

// emotional_memory가 있으면
"### How you feel about this relationship\n{emotional_memory}"

// 둘 다 없지만 summary가 있으면 (레거시 호환)
"### Your memory of this student\n{summary}"

// 최근 relationship_events 5개
"### Recent notable moments\n- [conflict] Student was rude\n- [breakthrough] Student made effort..."

// 아무것도 없으면 (첫 대화)
"### Memory\nThis is your first conversation with this student."
```
