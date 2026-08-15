export interface RunOutcome {
  success: boolean;
  partial: boolean;
  skipped: boolean;
  statusCode: 200 | 207 | 502;
}

export function runOutcome(completed: number, failed: number, total = completed + failed): RunOutcome {
  const safeCompleted = Math.max(0, Math.trunc(completed));
  const safeFailed = Math.max(0, Math.trunc(failed));
  const safeTotal = Math.max(0, Math.trunc(total));

  if (safeTotal === 0) {
    return { success: true, partial: false, skipped: true, statusCode: 200 };
  }
  if (safeCompleted === 0 && safeFailed > 0) {
    return { success: false, partial: false, skipped: false, statusCode: 502 };
  }
  if (safeFailed > 0) {
    return { success: true, partial: true, skipped: false, statusCode: 207 };
  }
  return { success: true, partial: false, skipped: false, statusCode: 200 };
}
