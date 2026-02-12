# 데이터베이스 스키마

채팅 시스템이 사용하는 6개 Supabase(Postgres) 테이블의 전체 스키마.

---

## teachers

AI 선생님 프로필 정보.

### 컬럼

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `id` | UUID | `gen_random_uuid()` | PK |
| `user_id` | UUID, nullable | - | FK -> `profiles.id`, 선생님이 실제 유저인 경우 |
| `name` | TEXT | - | 선생님 이름 |
| `bio` | TEXT, nullable | - | 선생님 소개 |
| `profile_image_url` | TEXT, nullable | - | 프로필 이미지 URL |
| `specialization` | TEXT[] | - | 전문 분야 배열 |
| `is_verified` | BOOLEAN | `false` | 인증 여부 |
| `is_active` | BOOLEAN | `true` | 활성 여부 |
| `persona_prompt` | TEXT, nullable | - | AI 성격 프롬프트 (우선순위 1) |
| `emotional_range` | JSONB | `'{}'` | 감정 반응 패턴 |
| `created_at` | TIMESTAMPTZ | `now()` | 생성일 |
| `updated_at` | TIMESTAMPTZ | `now()` | 수정일 |

### emotional_range JSON 키

```json
{
  "rude_response": "살짝 거리를 둠",           // 학생이 무례할 때 반응
  "ghost_response": "오랜만이라고 가볍게 언급",  // 학생이 잠수 탔을 때 반응
  "sad_student": "조용히 공감하며 들어줌",      // 학생이 슬플 때 반응
  "boundaries": "직접적으로 불쾌감 표현",       // 경계 설정 방식
  "forgiveness_speed": "빠르게 용서"           // 용서 속도
}
```

### 인덱스

| 인덱스 | 컬럼 | 조건 |
|--------|------|------|
| PK | `id` | - |
| `idx_teachers_user_id` | `user_id` | - |
| `idx_teachers_is_active` | `is_active` | `WHERE is_active = true` (partial) |

---

## chat_rooms

사용자와 선생님 간의 채팅방. 유저당 선생님당 하나의 방만 존재.

### 컬럼

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `id` | UUID | `gen_random_uuid()` | PK |
| `user_id` | UUID | - | FK -> `profiles.id` |
| `teacher_id` | UUID | - | FK -> `teachers.id` |
| `last_message_at` | TIMESTAMPTZ, nullable | - | 마지막 메시지 시각 |
| `user_unread_count` | INT | `0` | 사용자 미읽 메시지 수 |
| `teacher_unread_count` | INT | `0` | 선생님 미읽 메시지 수 |
| `is_active` | BOOLEAN | `true` | 채팅방 활성 여부 |
| `ai_responding_since` | TIMESTAMPTZ, nullable | - | AI 응답 처리 시작 시각 |
| `created_at` | TIMESTAMPTZ | `now()` | 생성일 |
| `updated_at` | TIMESTAMPTZ | `now()` | 수정일 |

### 제약 조건

| 제약 | 타입 | 설명 |
|------|------|------|
| `(user_id, teacher_id)` | UNIQUE | 유저당 선생님당 방 하나 |

### 트리거

| 트리거 | 함수 | 설명 |
|--------|------|------|
| `update_chat_rooms_updated_at` | `moddatetime(updated_at)` | UPDATE 시 `updated_at` 자동 갱신 |

### Realtime

활성화됨 (전체 컬럼).

---

## chat_messages

채팅 메시지. 사용자 메시지와 AI 선생님 메시지 모두 저장.

### 컬럼

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `id` | UUID | `gen_random_uuid()` | PK |
| `chat_room_id` | UUID | - | FK -> `chat_rooms.id` |
| `sender_type` | ENUM | - | `'user'` / `'teacher'` |
| `sender_id` | UUID | - | 발신자 ID (user.id 또는 teacher.id) |
| `content` | TEXT, nullable | - | 메시지 내용 |
| `message_type` | ENUM | `'text'` | `'text'` / `'image'` / `'audio'` / `'video'` / `'file'` / `'system'` |
| `media_url` | TEXT, nullable | - | 미디어 파일 URL |
| `is_read` | BOOLEAN | `false` | 읽음 여부 |
| `is_deleted` | BOOLEAN | `false` | 삭제 여부 (소프트 삭제) |
| `created_at` | TIMESTAMPTZ | `now()` | 생성일 |
| `visible_after` | TIMESTAMPTZ, nullable | - | 지연 표시 시각 (현재 미사용, BullMQ 대체) |

### 인덱스

| 인덱스 | 컬럼/조건 | 설명 |
|--------|-----------|------|
| PK | `id` | - |
| `idx_chat_messages_room_id` | `chat_room_id` | 채팅방별 메시지 조회 |
| `idx_chat_messages_created_at` | `(chat_room_id, created_at DESC)` | 시간순 메시지 조회 |
| `idx_chat_messages_unread` | `is_read` WHERE `is_read = false` | 미읽 메시지 조회 (partial) |
| `idx_chat_messages_visible_after` | `visible_after` WHERE `visible_after IS NOT NULL` | 지연 표시 메시지 (partial) |

### 트리거

| 트리거 | 함수 | 설명 |
|--------|------|------|
| `on_chat_message_insert` | `increment_user_unread_count` | teacher 메시지 INSERT 시 `chat_rooms.user_unread_count` +1 |

### Realtime

활성화됨.

---

## conversation_memories

채팅방별 대화 메모리. 채팅방 하나에 메모리 레코드 하나 (1:1).

### 컬럼

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `id` | UUID | `gen_random_uuid()` | PK |
| `chat_room_id` | UUID | - | FK -> `chat_rooms.id`, UNIQUE |
| `summary` | TEXT | `''` | 전체 요약 원문 (OpenAI 응답 전체) |
| `factual_memory` | TEXT | `''` | 사실 기억 (이름, 직업, 관심사 등) |
| `emotional_memory` | TEXT | `''` | 감정 기억 (선생님 관점 감정 회고) |
| `student_profile` | JSONB | `'{}'` | 학생 프로필 (구조화된 정보) |
| `messages_summarized` | INT | `0` | 요약 완료된 총 메시지 수 |
| `last_summarized_message_id` | UUID, nullable | - | FK -> `chat_messages.id`, 마지막 요약 메시지 |
| `created_at` | TIMESTAMPTZ | `now()` | 생성일 |
| `updated_at` | TIMESTAMPTZ | `now()` | 수정일 |

### student_profile JSON 구조

```json
{
  "english_level": "beginner" | "intermediate" | "advanced",
  "interests": ["K-pop", "travel", "gaming"],
  "communication_style": "casual and friendly",
  "learning_preference": "conversation-based"
}
```

### RLS

service role 전용 (클라이언트 직접 접근 불가).

---

## relationship_states

채팅방별 관계 상태. 채팅방 하나에 상태 레코드 하나 (1:1).

### 컬럼

| 컬럼 | 타입 | 범위 | 기본값 | 설명 |
|------|------|------|--------|------|
| `id` | UUID | - | `gen_random_uuid()` | PK |
| `chat_room_id` | UUID | - | - | FK -> `chat_rooms.id`, UNIQUE |
| `stage` | TEXT | CHECK | `'stranger'` | 관계 단계 |
| `warmth` | SMALLINT | 0-100 | `50` | 따뜻함 |
| `patience` | SMALLINT | 0-100 | `70` | 인내심 |
| `enthusiasm` | SMALLINT | 0-100 | `60` | 열정 |
| `trust` | SMALLINT | 0-100 | `30` | 신뢰 |
| `total_messages` | INT | - | `0` | 총 메시지 수 (user + teacher) |
| `user_messages` | INT | - | `0` | 사용자 메시지 수 |
| `consecutive_positive` | INT | - | `0` | 연속 긍정 횟수 |
| `consecutive_negative` | INT | - | `0` | 연속 부정 횟수 |
| `rude_count` | INT | - | `0` | 누적 무례 횟수 |
| `ghost_count` | INT | - | `0` | 누적 잠수 횟수 |
| `last_user_message_at` | TIMESTAMPTZ, nullable | - | - | 마지막 사용자 메시지 시각 |
| `current_streak_days` | INT | - | `0` | 현재 연속 출석일 |
| `longest_streak_days` | INT | - | `0` | 최장 연속 출석일 |
| `formality` | SMALLINT | 0-100 | `70` | 격식 수준 |
| `question_frequency` | SMALLINT | 0-100 | `60` | 질문 빈도 |
| `created_at` | TIMESTAMPTZ | - | `now()` | 생성일 |
| `updated_at` | TIMESTAMPTZ | - | `now()` | 수정일 |

### stage CHECK 제약

```sql
CHECK (stage IN ('stranger', 'acquaintance', 'comfortable', 'close_friend', 'best_friend'))
```

### RLS

service role 전용.

---

## relationship_events

관계 이벤트 기록. 한 채팅방에 여러 이벤트 (1:N).

### 컬럼

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `id` | UUID | `gen_random_uuid()` | PK |
| `chat_room_id` | UUID | - | FK -> `chat_rooms.id` |
| `event_type` | TEXT | - | 이벤트 유형 (CHECK 제약) |
| `summary` | TEXT | - | 이벤트 요약 |
| `detail` | JSONB | `'{}'` | 이벤트 상세 정보 |
| `emotional_valence` | SMALLINT | `0` | 감정 극성 (-5 ~ +5) |
| `message_id` | UUID, nullable | - | FK -> `chat_messages.id`, 관련 메시지 |
| `created_at` | TIMESTAMPTZ | `now()` | 생성일 |

### event_type CHECK 제약

```sql
CHECK (event_type IN (
  'personal_share',
  'inside_joke',
  'conflict',
  'breakthrough',
  'emotional_moment',
  'boundary_set',
  'reconciliation',
  'milestone',
  'topic_interest',
  'correction_accepted'
))
```

### RLS

service role 전용.

---

## 테이블 관계도

```
profiles (유저)
  |
  +--< chat_rooms (user_id FK)
  |      |
  |      +--< chat_messages (chat_room_id FK, 1:N)
  |      |      |
  |      |      +--< relationship_events.message_id (optional FK)
  |      |
  |      +---- conversation_memories (chat_room_id FK, 1:1 UNIQUE)
  |      |
  |      +---- relationship_states (chat_room_id FK, 1:1 UNIQUE)
  |      |
  |      +--< relationship_events (chat_room_id FK, 1:N)
  |
teachers (AI 선생님)
  |
  +--< chat_rooms (teacher_id FK)
```

### 핵심 관계 요약

- `profiles` 1:N `chat_rooms`: 한 유저가 여러 선생님과 대화 가능
- `teachers` 1:N `chat_rooms`: 한 선생님이 여러 유저와 대화 가능
- `(user_id, teacher_id)` UNIQUE: 유저-선생님 조합당 방 하나
- `chat_rooms` 1:N `chat_messages`: 한 방에 여러 메시지
- `chat_rooms` 1:1 `conversation_memories`: 방당 메모리 하나
- `chat_rooms` 1:1 `relationship_states`: 방당 관계 상태 하나
- `chat_rooms` 1:N `relationship_events`: 방에 여러 이벤트
