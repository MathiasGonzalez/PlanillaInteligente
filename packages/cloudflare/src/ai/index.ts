export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

type AiBinding = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
};

export function resolveAiModel(modelOverride?: string): string {
  return modelOverride || DEFAULT_AI_MODEL;
}

export async function runAiInference(
  ai: AiBinding,
  model: string,
  input: unknown,
  gatewayId?: string,
): Promise<unknown> {
  const options = gatewayId
    ? { gateway: { id: gatewayId, collectLog: false } }
    : undefined;
  return ai.run(model, input, options);
}

export function extractAiResponse(response: unknown): unknown {
  if (typeof response === 'string') {
    try {
      return JSON.parse(response) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof response === 'object' && response !== null && 'response' in response) {
    return extractAiResponse((response as { response: unknown }).response);
  }
  return response;
}
