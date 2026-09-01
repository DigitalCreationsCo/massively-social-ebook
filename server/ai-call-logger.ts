type AiCallDetails = {
  method: string;
  provider?: string;
  model?: string;
  parameters: Record<string, unknown>;
  instructions?: string;
  prompt?: string;
  input?: string;
};

type AiConfiguration = {
  text: { provider: string; model: string };
  image: { provider: string; model: string };
  embedding: { provider: string; model: string };
};

let nextCallId = 1;

export function logAiConfiguration(configuration: AiConfiguration): void {
  console.info(`[AI] configured models ${JSON.stringify(configuration)}`);
}

/**
 * Logs AI requests as small, readable records. Prompts and text inputs are
 * deliberately included; credentials, model instances, and generated binary
 * data are never logged.
 */
export function logAiCall(details: AiCallDetails): { callId: number; startedAt: number } {
  const callId = nextCallId++;
  const startedAt = Date.now();
  const metadata = {
    callId,
    provider: details.provider,
    model: details.model,
    parameters: details.parameters,
  };
  const textSections = [
    details.instructions === undefined
      ? undefined
      : `[AI] ${details.method} instructions:\n${details.instructions}`,
    details.prompt === undefined ? undefined : `[AI] ${details.method} prompt:\n${details.prompt}`,
    details.input === undefined ? undefined : `[AI] ${details.method} input:\n${details.input}`,
  ].filter((section): section is string => Boolean(section));

  console.info(
    [`[AI] ${details.method} call ${JSON.stringify(metadata)}`, ...textSections].join("\n"),
  );

  return { callId, startedAt };
}

export function logAiCallComplete(
  method: string,
  call: { callId: number; startedAt: number },
  result: Record<string, unknown> = {},
): void {
  console.info(
    `[AI] ${method} complete ${JSON.stringify({
      callId: call.callId,
      durationMs: Date.now() - call.startedAt,
      ...result,
    })}`,
  );
}

export function logAiCallFailure(
  method: string,
  call: { callId: number; startedAt: number },
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[AI] ${method} failed ${JSON.stringify({
      callId: call.callId,
      durationMs: Date.now() - call.startedAt,
      error: message,
    })}`,
  );
}
