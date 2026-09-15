export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

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
  const options = gatewayId ? { gateway: { id: gatewayId } } : undefined;
  return ai.run(model, input, options);
}
