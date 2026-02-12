import { Injectable } from '@nestjs/common';
import { RelationshipState } from './sentiment.service';

@Injectable()
export class AntiPatternService {
  getAntiPatternDirective(state: RelationshipState): string {
    const directives: string[] = [];
    const maxQuestionFreq: Record<string, number> = {
      stranger: 70,
      acquaintance: 60,
      comfortable: 50,
      close_friend: 40,
      best_friend: 30,
    };
    const cap = maxQuestionFreq[state.stage] || 50;
    const shouldAskQuestion =
      Math.random() * 100 < Math.min(state.question_frequency, cap);

    if (!shouldAskQuestion) {
      directives.push(
        'DO NOT ask a question in this message. Just react, comment, or share.',
      );
    }

    const lengthRoll = Math.random();
    if (lengthRoll < 0.25) {
      directives.push(
        'Keep this response VERY short: just 1-5 words. A quick reaction like "ㅋㅋ 진짜?", "oh nice", "헐", "lol same", "아 그랬구나".',
      );
    } else if (lengthRoll < 0.5) {
      directives.push('Keep this response to ONE sentence max.');
    } else if (lengthRoll < 0.85) {
      directives.push('Normal length: 1-2 sentences.');
    } else {
      directives.push(
        'You can write a bit more than usual IF you genuinely have something to say. 2-3 sentences max.',
      );
    }

    const styleRoll = Math.random();
    if (styleRoll < 0.1) {
      directives.push(
        'Style hint: just react with emoji or ㅋㅋ/ㅎㅎ type reaction. No real content needed.',
      );
    } else if (styleRoll < 0.2) {
      directives.push(
        'Style hint: instead of responding directly, share a brief related personal experience or opinion.',
      );
    } else if (styleRoll < 0.3) {
      directives.push(
        'Style hint: lightly tease or playfully disagree with what the student said.',
      );
    } else if (styleRoll < 0.4) {
      directives.push(
        'Style hint: naturally shift the topic to something related but new.',
      );
    }

    return `## Response Style for THIS Message\n${directives.join('\n')}`;
  }
}
