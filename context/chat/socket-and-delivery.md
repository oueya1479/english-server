# 실시간 전달 시스템

Socket.IO 게이트웨이와 BullMQ 지연 전달 시스템 상세.
구현 파일: `src/chat/chat.gateway.ts`, `src/chat/chat-delivery.processor.ts`

---

## Socket.IO 게이트웨이

### 기본 설정

```typescript
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
```

- **네임스페이스**: `/chat`
- **CORS**: origin `'*'` (모든 출처 허용)
- **인증**: `handshake.auth.token`으로 Supabase JWT 검증

---

### 연결 흐름 (handleConnection)

```
Client connects with auth.token
  |
  +--> JWT 검증 (supabaseService.client.auth.getUser(token))
  |     |
  |     +-- 실패: client.disconnect()
  |     +-- 성공: client.data.userId = user.id
  |
  +--> user:{userId} 방 자동 조인 (race condition 방지)
```

- 토큰 없음 -> 즉시 연결 해제
- JWT 검증 실패 -> 연결 해제 + 경고 로그
- 성공 시 `client.data.userId`에 유저 ID 저장
- `user:{userId}` 방에 서버 측에서 자동 조인 (클라이언트의 `join_user_room` 이벤트보다 먼저 실행되어 race condition 방지)

### 연결 해제 (handleDisconnect)

```typescript
async handleDisconnect(client: Socket) {
  const userId = client.data?.userId;
  if (userId) {
    await redisService.client.del(`active_room:${userId}`);
  }
}
```

- Redis의 `active_room:{userId}` 키 삭제 (접속 중인 채팅방 정보 정리)

---

### 클라이언트 -> 서버 이벤트

| 이벤트 | 데이터 | 동작 |
|--------|--------|------|
| `join_room` | `{ chatRoomId: string }` | `room:{chatRoomId}` 조인 + Redis `active_room:{userId}` 설정 (TTL 1시간) |
| `leave_room` | `{ chatRoomId: string }` | 방 떠남 + Redis `active_room:{userId}` 삭제 (현재 방과 일치할 때만) |
| `join_user_room` | (없음) | `user:{userId}` 조인 (개인 채널, handleConnection에서 이미 처리) |

#### join_room 상세

```typescript
@SubscribeMessage('join_room')
async handleJoinRoom(client: Socket, data: { chatRoomId: string }) {
  client.join(`room:${data.chatRoomId}`);

  // Redis에 현재 접속 중인 채팅방 기록
  await redisService.client.set(
    `active_room:${userId}`,
    data.chatRoomId,
    'EX', 3600  // 1시간 TTL
  );
}
```

#### leave_room 상세

```typescript
@SubscribeMessage('leave_room')
async handleLeaveRoom(client: Socket, data: { chatRoomId: string }) {
  client.leave(`room:${data.chatRoomId}`);

  // 현재 활성 방과 일치할 때만 삭제 (다른 방으로 전환한 경우 보호)
  const activeRoom = await redisService.client.get(`active_room:${userId}`);
  if (activeRoom === data.chatRoomId) {
    await redisService.client.del(`active_room:${userId}`);
  }
}
```

---

### 서버 -> 클라이언트 이벤트

| 이벤트 | 대상 방 | 페이로드 | 설명 |
|--------|---------|----------|------|
| `typing_start` | `room:{chatRoomId}` | (없음) | AI 타이핑 시작 |
| `new_message` | `room:{chatRoomId}` | `savedMessage` (DB 레코드) | AI 메시지 전달 |
| `typing_stop` | `room:{chatRoomId}` | (없음) | AI 타이핑 종료 |
| `chat_room_updated` | `user:{userId}` | `{ chatRoomId, teacherName, teacherProfileImageUrl, lastMessageContent }` | 채팅방 목록 갱신용 |

#### 서비스 호출용 메서드

```typescript
emitNewMessage(chatRoomId: string, message: any)     // new_message emit
emitTypingStart(chatRoomId: string)                    // typing_start emit
emitTypingStop(chatRoomId: string)                     // typing_stop emit
emitToUser(userId: string, event: string, data: any)   // 유저 개인 채널 emit
isUserInRoom(userId: string, chatRoomId: string)       // Redis active_room 확인
```

---

## BullMQ 전달 시스템

### 큐 설정

```typescript
// chat.module.ts
BullModule.registerQueue({ name: 'chat-delivery' })

// chat-delivery.processor.ts
@Processor('chat-delivery')
export class ChatDeliveryProcessor extends WorkerHost { ... }
```

- 큐 이름: `chat-delivery`
- 잡 이름: `deliver-message`

### 잡 데이터 인터페이스

```typescript
interface ChatDeliveryJobData {
  chatRoomId: string;
  userId: string;
  teacherName: string;
  teacherId: string;
  teacherProfileImageUrl: string;
  message: {
    chat_room_id: string;
    sender_type: 'teacher';
    sender_id: string;
    content: string;
  };
  isFirst: boolean;  // 첫 번째 메시지 여부 (FCM 발송 조건)
  isLast: boolean;   // 마지막 메시지 여부 (typing_stop 조건)
}
```

---

### 딜레이 계산

`ChatService.processChatRoom()`에서 계산:

```typescript
const initialDelay = 1500;  // AI "생각 시간" (ms)
let cumulativeDelay = initialDelay;

const interMessageGap = 1500;  // 메시지 간 갭 (ms)

for (let i = 0; i < aiMessages.length; i++) {
  const typingDuration = calculateTypingDuration(aiMessages[i]);

  if (i > 0) {
    cumulativeDelay += interMessageGap;  // 두 번째부터 갭 추가
  }
  cumulativeDelay += typingDuration;

  await chatDeliveryQueue.add('deliver-message', jobData, {
    delay: cumulativeDelay,
  });
}
```

#### 타이핑 시간 계산

```typescript
private calculateTypingDuration(content: string): number {
  const duration = content.length * 50;  // 글자당 50ms
  return Math.max(1000, Math.min(5000, duration));  // 1초~5초
}
```

| 글자 수 | 원시 값 | clamp 결과 |
|---------|---------|-----------|
| 5 | 250ms | 1000ms (최소) |
| 20 | 1000ms | 1000ms |
| 50 | 2500ms | 2500ms |
| 100 | 5000ms | 5000ms |
| 200 | 10000ms | 5000ms (최대) |

#### 딜레이 예시 (3개 메시지)

메시지: ["ㅋㅋ" (2자), "그거 재밌었어?" (8자), "나도 해봤는데 진짜 별로였음" (15자)]

```
msg[0]: cumulativeDelay = 1500 + max(1000, min(5000, 2*50))
                        = 1500 + 1000 = 2500ms

msg[1]: cumulativeDelay = 2500 + 1500 + max(1000, min(5000, 8*50))
                        = 2500 + 1500 + 1000 = 5000ms

msg[2]: cumulativeDelay = 5000 + 1500 + max(1000, min(5000, 15*50))
                        = 5000 + 1500 + 1000 = 7500ms
```

> 딜레이는 잡 등록 시점 기준 절대값이므로, 각 잡은 등록 후 해당 밀리초 후에 실행된다.

---

### 각 Job 실행 흐름

`ChatDeliveryProcessor.process()`:

```
1. Redis active_room:{userId}로 유저 인룸 여부 체크
   |
2. chat_messages에 AI 메시지 INSERT
   - is_read = userInRoom (인룸이면 바로 읽음 처리)
   |
3. chat_rooms 갱신
   - 인룸: last_message_at 갱신 + user_unread_count = 0
   - 미인룸: last_message_at만 갱신 (unread는 DB 트리거가 처리)
   |
4. Socket.IO new_message emit -> room:{chatRoomId}
   |
5. 마지막 메시지이면 (isLast):
   - typing_stop emit
   - Redis typing:{chatRoomId} 키 삭제
   |
6. 첫 메시지 + 유저 미접속이면 (isFirst && !userInRoom):
   - FCM 푸시 발송
   |
7. chat_room_updated emit -> user:{userId}
```

### unread_count 처리 (DB 트리거와의 협업)

```
DB 트리거: on_chat_message_insert
  -> teacher 메시지 INSERT 시 chat_rooms.user_unread_count +1 (무조건)

BullMQ 워커:
  -> userInRoom이면: user_unread_count = 0으로 리셋 (트리거 상쇄)
  -> !userInRoom이면: 트리거가 올린 값 유지
```

---

## FCM 푸시 알림

### 발송 조건

```typescript
if (isFirst && !userInRoom) {
  // 첫 번째 AI 메시지 AND 유저가 해당 채팅방에 미접속
}
```

- `isFirst`: 멀티 메시지 중 첫 번째만 (중복 발송 방지)
- `!userInRoom`: Redis `active_room:{userId}`로 판단

### 발송 내용

```typescript
await firebaseService.sendPushNotification(
  userId,                    // 수신자
  teacherName,               // 알림 제목 (선생님 이름)
  content.length > 100       // 알림 내용 (100자 초과 시 자르기)
    ? content.substring(0, 97) + '...'
    : content,
  {
    chat_room_id: chatRoomId,
    teacher_id: teacherId,
    teacher_image_url: teacherProfileImageUrl,
  },
);
```

### 에러 처리

- FCM 발송 실패 시 경고 로그만 남김 (메시지 전달 자체에 영향 없음)
- 무효 FCM 토큰은 `FirebaseService` 내부에서 자동 정리

---

## Redis 키 패턴

| 키 | 용도 | TTL | 설정 위치 | 삭제 위치 |
|----|------|-----|-----------|-----------|
| `chat_lock:{chatRoomId}` | 분산 락 (동시 AI 처리 방지) | 60초 | `ChatService.processAiResponse` | `ChatService.processAiResponse` (finally) |
| `teacher:{teacherId}` | Teacher 정보 캐시 | 1시간 (3600초) | `ChatService.fetchTeacher` | TTL 만료 |
| `typing:{chatRoomId}` | 타이핑 상태 (is_typing, until) | 60초 | `ChatService.processChatRoom` | `ChatDeliveryProcessor.process` (isLast) |
| `active_room:{userId}` | 유저가 현재 접속 중인 채팅방 ID | 1시간 (3600초) | `ChatGateway.handleJoinRoom` | `ChatGateway.handleLeaveRoom` / `handleDisconnect` |

### typing 키 상세

```json
{
  "is_typing": true,
  "until": 1700000000000  // Date.now() + initialDelay + totalTypingDuration
}
```

- BullMQ 작업 스케줄링 직전에 설정
- 마지막 메시지 전달 시 삭제
- 클라이언트가 타이핑 상태를 폴링할 때 사용 가능 (현재는 Socket.IO 이벤트 기반)

---

## 타이밍 다이어그램 (3개 메시지 응답 예시)

```
시간(ms)  0        1500      2500      5000      7500
          |         |         |         |         |
          |         |         | msg1    | msg2    | msg3
          |         |         | deliver | deliver | deliver
          |         |         |         |         |
          +-- API   +-- lock  +-- emit  +-- emit  +-- emit
              응답      5s       new_     new_      new_
                     debounce   message  message   message
                     + OpenAI                     + typing_stop
                     + typing                     + FCM (if offline)
                       _start
```

> 실제로는 디바운스(5초) + OpenAI 호출 시간이 추가되므로, 사용자 메시지 전송 후 최소 6~8초 후에 첫 AI 메시지가 도착한다.
