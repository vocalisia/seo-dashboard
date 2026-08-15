export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  for (const key of ["error", "message", "detail"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return fallback;
}

export async function readApiJson<T>(
  response: Response,
  isExpectedPayload: (payload: unknown) => payload is T,
  fallbackMessage: string,
): Promise<T> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(`${fallbackMessage} (réponse JSON invalide, HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `${fallbackMessage} (HTTP ${response.status})`),
    );
  }

  if (!isExpectedPayload(payload)) {
    throw new Error(
      getApiErrorMessage(payload, `${fallbackMessage} (réponse API invalide)`),
    );
  }

  return payload;
}
