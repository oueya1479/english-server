import { Injectable } from '@nestjs/common';
import { MessageSentiment, RelationshipState } from './sentiment.service';

export interface DetectedEvent {
  event_type: string;
  summary: string;
  emotional_valence: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

@Injectable()
export class RelationshipService {
  applyTimeEffects(
    state: RelationshipState,
    teacher: {
      name: string;
      emotional_range?: Record<string, string> | null;
    },
  ): { state: RelationshipState; timeContext: string } {
    const updated = { ...state };
    let timeContext = '';

    if (!state.last_user_message_at) {
      return { state: updated, timeContext };
    }

    const now = new Date();
    const lastMsg = new Date(state.last_user_message_at);
    const hoursSince =
      (now.getTime() - lastMsg.getTime()) / (1000 * 60 * 60);

    // Patience recovery for absence >= 6 hours
    if (hoursSince >= 6) {
      const recoveryBlocks = Math.floor(hoursSince / 6);
      updated.patience = clamp(
        updated.patience + recoveryBlocks * 5,
        0,
        80,
      );
    }

    // Ghost detection: 48h to 168h
    if (hoursSince >= 48 && hoursSince < 168) {
      updated.enthusiasm = clamp(updated.enthusiasm - 10, 0, 100);
      updated.warmth = clamp(updated.warmth - 5, 0, 100);
      const ghostResponse =
        teacher.emotional_range?.ghost_response ||
        '오랜만이라고 가볍게 언급';
      timeContext = `The student has been away for ${Math.floor(hoursSince / 24)} days. React naturally based on your personality: ${ghostResponse}`;
    }

    // Full ghost: >= 168h (1 week)
    if (hoursSince >= 168) {
      updated.ghost_count += 1;
      updated.current_streak_days = 0;
      updated.enthusiasm = clamp(updated.enthusiasm - 20, 0, 100);
      updated.warmth = clamp(updated.warmth - 10, 0, 100);
      const ghostResponse =
        teacher.emotional_range?.ghost_response || '오랜만이라고 언급';
      timeContext = `The student ghosted for ${Math.floor(hoursSince / 24)} days (ghost count: ${updated.ghost_count}). React naturally: ${ghostResponse}`;
    }

    return { state: updated, timeContext };
  }

  updateStreak(state: RelationshipState): RelationshipState {
    const updated = { ...state };

    if (!state.last_user_message_at) {
      updated.current_streak_days = 1;
      updated.longest_streak_days = Math.max(
        updated.longest_streak_days,
        1,
      );
      return updated;
    }

    const now = new Date();
    const last = new Date(state.last_user_message_at);
    const nowDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const lastDate = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate(),
    );
    const daysDiff = Math.floor(
      (nowDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff === 0) {
      // Same day, no change
    } else if (daysDiff === 1) {
      updated.current_streak_days += 1;
    } else {
      updated.current_streak_days = 1;
    }

    updated.longest_streak_days = Math.max(
      updated.longest_streak_days,
      updated.current_streak_days,
    );

    return updated;
  }

  checkStageTransition(state: RelationshipState): string {
    const { stage, user_messages, warmth, trust, current_streak_days } =
      state;

    // Check promotions
    if (stage === 'stranger' && user_messages >= 10 && warmth >= 40) {
      return 'acquaintance';
    }
    if (stage === 'acquaintance' && user_messages >= 50 && trust >= 50) {
      return 'comfortable';
    }
    if (
      stage === 'comfortable' &&
      user_messages >= 150 &&
      trust >= 70 &&
      current_streak_days >= 5
    ) {
      return 'close_friend';
    }
    if (
      stage === 'close_friend' &&
      user_messages >= 500 &&
      trust >= 85 &&
      current_streak_days >= 14
    ) {
      return 'best_friend';
    }

    // Check demotions
    if (stage === 'best_friend' && trust < 70) return 'close_friend';
    if (stage === 'close_friend' && trust < 55) return 'comfortable';
    if (stage === 'comfortable' && trust < 35) return 'acquaintance';
    if (stage === 'acquaintance' && trust < 25) return 'stranger';

    return stage;
  }

  detectEvents(
    content: string,
    sentiment: MessageSentiment,
    state: RelationshipState,
  ): DetectedEvent[] {
    const events: DetectedEvent[] = [];

    if (sentiment === 'rude') {
      events.push({
        event_type: 'conflict',
        summary: `Student was rude (count: ${state.rude_count})`,
        emotional_valence: -3,
      });
    }

    if (sentiment === 'personal_share') {
      events.push({
        event_type: 'personal_share',
        summary: `Student shared something personal (${content.substring(0, 50)}...)`,
        emotional_valence: 2,
      });
    }

    if (sentiment === 'positive' && state.consecutive_negative >= 2) {
      events.push({
        event_type: 'reconciliation',
        summary: 'Student became positive after negative streak',
        emotional_valence: 3,
      });
    }

    if (sentiment === 'english_effort') {
      events.push({
        event_type: 'breakthrough',
        summary: 'Student made effort to use English',
        emotional_valence: 2,
      });
    }

    // Milestone events
    const milestones = [10, 50, 100, 200, 500, 1000];
    const newUserMsgCount = state.user_messages + 1;
    if (milestones.includes(newUserMsgCount)) {
      events.push({
        event_type: 'milestone',
        summary: `Reached ${newUserMsgCount} messages together`,
        emotional_valence: 2,
      });
    }

    return events;
  }
}
