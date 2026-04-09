import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { logger } from './Logger';

dotenv.config();

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export class ClaudeClient {
  private client: Anthropic;
  private defaultModel: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        '❌ ANTHROPIC_API_KEY is not set. Please add it to your .env file.'
      );
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  }

  /**
   * Send a single prompt and get a completion.
   */
  async complete(prompt: string, options: ClaudeOptions = {}): Promise<string> {
    const {
      model = this.defaultModel,
      maxTokens = 8192,
      system,
    } = options;

    logger.debug(`ClaudeClient.complete — model: ${model}, prompt length: ${prompt.length}`);

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      return content.text;
    } catch (error: any) {
      logger.error(`Claude API error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Multi-turn conversation.
   */
  async chat(messages: ClaudeMessage[], options: ClaudeOptions = {}): Promise<string> {
    const { model = this.defaultModel, maxTokens = 8192, system } = options;

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      return content.text;
    } catch (error: any) {
      logger.error(`Claude API chat error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract JSON from a Claude response (handles markdown code blocks).
   */
  parseJSON<T>(rawResponse: string): T {
    // Strip markdown code fences if present
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try to extract JSON object/array from text
      const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) {
        return JSON.parse(match[1]) as T;
      }
      throw new Error(`Failed to parse Claude response as JSON: ${cleaned.substring(0, 200)}`);
    }
  }
}
