/**
 * One JSON line per event — easy to grep and ship to log aggregators.
 */
export function logAutopilot(msg: string, data?: Record<string, unknown>): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    scope: "autopilot",
    msg,
    ...data,
  };
  console.log(JSON.stringify(line));
}
