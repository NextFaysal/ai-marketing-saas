export interface ImageGenResult {
  bytes: Buffer;
  contentType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tokensEstimated: boolean;
}

export interface ImageProvider {
  readonly name: string;
  readonly isRealProvider: true;
  generate(prompt: string): Promise<ImageGenResult>;
}

export class ImageConfigError extends Error {}
