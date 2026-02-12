# 채팅 시스템 개요

## 시스템 설명

English Shorts 앱의 AI 선생님 채팅 시스템. 사용자가 AI 영어 선생님과 1:1 실시간 대화를 통해 영어를 학습한다. AI 선생님은 단순한 챗봇이 아니라, 감정과 관계가 있는 "사람 같은" 대화 상대로 설계되었다.

## 핵심 기능

| 기능 | 설명 |
|------|------|
| AI 선생님 1:1 대화 | 각 선생님의 고유 성격(persona)을 반영한 자연스러운 대화 |
| 4축 감정 시스템 | warmth, patience, enthusiasm, trust로 선생님의 감정 상태를 수치화 |
| 5단계 관계 시스템 | stranger -> acquaintance -> comfortable -> close_friend -> best_friend 진화/퇴보 |
| 3레이어 메모리 | 사실 기억(factual), 감정 기억(emotional), 학생 프로필(student_profile) |
| 안티패턴 시스템 | AI의 반복적 응답 패턴을 매 호출마다 랜덤화로 방지 |
| 감정 분류 | 규칙 기반 정규식으로 사용자 메시지의 감정 6단계 분류 |
| 멀티 버블 응답 | AI가 여러 개의 메시지 버블로 나누어 자연스럽게 응답 |
| 스태거드 전달 | 타이핑 시뮬레이션으로 시간차를 두고 메시지 전달 |
| FCM 푸시 알림 | 오프라인 사용자에게 첫 번째 AI 메시지만 푸시 발송 |

## 기술 스택

| 기술 | 역할 |
|------|------|
| **NestJS** | 백엔드 프레임워크 |
| **Socket.IO** | 실시간 양방향 통신 (네임스페이스: `/chat`) |
| **BullMQ** | 지연 작업 큐 (메시지 스태거드 전달) |
| **Redis (ioredis)** | 분산 락, 캐싱, 타이핑 상태, 접속 상태 관리 |
| **OpenAI (gpt-4o-mini)** | AI 응답 생성 (temp 0.85, max_tokens 300, structured JSON output) |
| **Supabase (Postgres)** | 데이터베이스 (채팅 메시지, 관계 상태, 메모리 등) |
| **FCM (Firebase Cloud Messaging)** | 오프라인 사용자 푸시 알림 |

## 통신 방식: 하이브리드 아키텍처

```
클라이언트 --[REST POST]--> 서버     (메시지 전송)
서버 --[Socket.IO emit]--> 클라이언트  (AI 응답 실시간 수신)
서버 --[FCM push]--> 클라이언트        (오프라인 시 푸시 알림)
```

- **메시지 전송**: REST API (`POST /api/v1/chat/send-message`) + JWT 인증
- **응답 수신**: Socket.IO WebSocket (`/chat` 네임스페이스)
- **오프라인**: FCM 푸시 알림 (첫 번째 AI 메시지만)

## 아키텍처 구성 파일

`src/chat/` 디렉토리 하위 11개 파일:

| 파일 | 역할 |
|------|------|
| `chat.module.ts` | 채팅 모듈 정의. OpenAIModule, FirebaseModule 임포트, BullMQ 큐 등록 |
| `chat.controller.ts` | REST API 엔드포인트. `POST /chat/send-message` |
| `chat.service.ts` | 핵심 오케스트레이터. 메시지 저장, AI 파이프라인 트리거, BullMQ 작업 스케줄링 |
| `chat-ai.service.ts` | 시스템 프롬프트 빌드. 10개 섹션 조합 (Identity, Personality, Stage, Emotion, Memory 등) |
| `chat.gateway.ts` | Socket.IO 게이트웨이. 연결 인증, 방 관리, 이벤트 emit |
| `chat-delivery.processor.ts` | BullMQ 워커. 지연 후 DB INSERT, Socket.IO emit, FCM 발송 |
| `sentiment.service.ts` | 감정 분류 (regex 기반) + 감정 델타 적용 |
| `relationship.service.ts` | 관계 시스템. 시간 효과, 스트릭, 단계 전환, 이벤트 감지 |
| `memory.service.ts` | 3레이어 메모리 요약. OpenAI로 증분 요약 |
| `anti-pattern.service.ts` | 안티패턴 지시문 생성. 질문/길이/스타일 랜덤화 |
| `dto/send-message.dto.ts` | 메시지 전송 DTO. `chat_room_id` (UUID), `content` (최대 5000자) |

## 관련 문서

- [메시지 흐름](./message-flow.md) - 전체 메시지 전송~수신 플로우
- [데이터베이스 스키마](./database-schema.md) - 6개 테이블 전체 스키마
- [관계 시스템](./relationship-system.md) - 4축 감정 + 5단계 관계
- [감정 분류 시스템](./sentiment-system.md) - 규칙 기반 감정 분류
- [메모리 시스템](./memory-system.md) - 3레이어 대화 메모리
- [안티패턴 시스템](./anti-pattern-system.md) - AI 응답 다양화
- [AI 프롬프트 시스템](./ai-prompt-system.md) - 시스템 프롬프트 구성
- [실시간 전달 시스템](./socket-and-delivery.md) - Socket.IO + BullMQ 전달
