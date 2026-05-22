// GSC reporting lag — GSC finalises data ~2-3 days after the fact.
// Dashboard windows MUST exclude the lag period or they sum partial / zero-value
// dates and look wildly off vs the live GSC UI.
//
// Apply in SQL like:
//   WHERE date >= CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS})
//     AND date <= CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS}
//
// Example with GSC_LAG_DAYS=3 and days=3 on 2026-05-22:
//   start = 2026-05-17, end = 2026-05-19  (3 fully reported days)
export const GSC_LAG_DAYS = 3;
