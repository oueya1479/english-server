import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';

export interface ChatCompletionOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'text' | 'json_object' };
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly client: OpenAI;

  private static readonly DEFAULT_MODEL = 'gpt-4o-mini';
  private static readonly DEFAULT_MAX_TOKENS = 300;
  private static readonly DEFAULT_TEMPERATURE = 0.85;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
  }

  /**
   * Send a chat completion request to the OpenAI API.
   *
   * @param messages - The conversation messages array.
   * @param options  - Optional overrides for model, max_tokens, temperature, and response_format.
   * @returns The assistant's reply content, or null on failure.
   */
  async chatCompletion(
    messages: ChatCompletionMessageParam[],
    options?: ChatCompletionOptions,
  ): Promise<string | null> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: options?.model ?? OpenAIService.DEFAULT_MODEL,
      max_tokens: options?.max_tokens ?? OpenAIService.DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? OpenAIService.DEFAULT_TEMPERATURE,
      messages,
      ...(options?.response_format && {
        response_format: options.response_format,
      }),
    };

    try {
      const response = await this.client.chat.completions.create(params);
      return response.choices[0]?.message?.content ?? null;
    } catch (error) {
      this.logger.error(`OpenAI chat completion failed: ${error}`);
      return null;
    }
  }
}
