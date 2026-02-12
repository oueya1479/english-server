import { Injectable } from '@nestjs/common';

export type MessageSentiment =
  | 'rude'
  | 'dismissive'
  | 'positive'
  | 'english_effort'
  | 'personal_share'
  | 'neutral';

export interface RelationshipState {
  id?: string;
  chat_room_id: string;
  stage: string;
  warmth: number;
  patience: number;
  enthusiasm: number;
  trust: number;
  total_messages: number;
  user_messages: number;
  consecutive_positive: number;
  consecutive_negative: number;
  rude_count: number;
  ghost_count: number;
  last_user_message_at: string | null;
  current_streak_days: number;
  longest_streak_days: number;
  formality: number;
  question_frequency: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

@Injectable()
export class SentimentService {
  private readonly rudePatterns: RegExp[] = [
    /[씨시]발/,
    /[ㅅㅆ][ㅂ]/,
    /병신/,
    /꺼져/,
    /닥[쳐쵸]/,
    /미친/,
    /[ㅈ]같/,
    /개[새세]끼/,
    /바보/,
    /멍청/,
    /fuck/i,
    /shit/i,
    /stupid/i,
    /shut\s*up/i,
    /idiot/i,
    /dumb/i,
    /hate\s*you/i,
    /go\s*away/i,
  ];

  private readonly dismissivePatterns: RegExp[] = [
    /^[ㅇㅎㄴㄱㅋㅎ]{1,4}$/,
    /^(ㅇㅇ|ㄴㄴ|ㄱㄱ|ㅇㅋ|ㅎㅎ|ㅋㅋ)$/,
    /^(네|응|ㅇ|어|ok|no|yeah|nah|sure|k|idk)$/i,
    /^싫[어다]?$/,
    /^됐[어다]?$/,
    /^몰[라라]?$/,
    /^귀찮/,
    /^재미없/,
  ];

  private readonly positivePatterns: RegExp[] = [
    /고마[워웠]/,
    /감사/,
    /ㅋㅋㅋ+/,
    /ㅎㅎㅎ+/,
    /재[밌미]/,
    /좋[아았]/,
    /최고/,
    /thank/i,
    /awesome/i,
    /great/i,
    /love\s*(it|this|that)/i,
    /haha/i,
    /lol/i,
    /nice/i,
    /cool/i,
    /amazing/i,
    /helpful/i,
    /fun/i,
  ];

  classifyUserMessage(content: string): MessageSentiment {
    const trimmed = content.trim();

    // Check rude patterns first
    for (const pattern of this.rudePatterns) {
      if (pattern.test(trimmed)) return 'rude';
    }

    // Check dismissive patterns
    for (const pattern of this.dismissivePatterns) {
      if (pattern.test(trimmed)) return 'dismissive';
    }

    // Check positive patterns
    for (const pattern of this.positivePatterns) {
      if (pattern.test(trimmed)) return 'positive';
    }

    // Check for english effort
    const totalChars = trimmed.length;
    if (totalChars > 5) {
      const englishChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
      if (englishChars / totalChars > 0.4) return 'english_effort';
    }

    // Check for personal share
    if (trimmed.length > 60) return 'personal_share';

    return 'neutral';
  }

  applyEmotionDelta(
    state: RelationshipState,
    sentiment: MessageSentiment,
  ): RelationshipState {
    const updated = { ...state };

    switch (sentiment) {
      case 'rude':
        updated.warmth = clamp(updated.warmth - 8, 0, 100);
        updated.patience = clamp(updated.patience - 12, 0, 100);
        updated.trust = clamp(updated.trust - 6, 0, 100);
        updated.consecutive_negative += 1;
        updated.consecutive_positive = 0;
        updated.rude_count += 1;
        break;

      case 'dismissive':
        updated.patience = clamp(updated.patience - 5, 0, 100);
        updated.enthusiasm = clamp(updated.enthusiasm - 4, 0, 100);
        updated.consecutive_negative += 1;
        updated.consecutive_positive = 0;
        break;

      case 'positive':
        updated.warmth = clamp(updated.warmth + 3, 0, 100);
        updated.enthusiasm = clamp(updated.enthusiasm + 4, 0, 100);
        updated.consecutive_positive += 1;
        updated.consecutive_negative = 0;
        break;

      case 'english_effort':
        updated.enthusiasm = clamp(updated.enthusiasm + 5, 0, 100);
        updated.trust = clamp(updated.trust + 2, 0, 100);
        updated.consecutive_positive += 1;
        updated.consecutive_negative = 0;
        break;

      case 'personal_share':
        updated.trust = clamp(updated.trust + 2, 0, 100);
        updated.warmth = clamp(updated.warmth + 1, 0, 100);
        updated.consecutive_positive += 1;
        updated.consecutive_negative = 0;
        break;

      case 'neutral':
        updated.patience = clamp(updated.patience + 1, 0, 100);
        updated.consecutive_negative = 0;
        break;
    }

    return updated;
  }
}
