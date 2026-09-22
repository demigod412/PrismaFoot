/** How far ahead fixtures are fetched, predicted and shown. 21 days covers international breaks. */
export const FIXTURE_WINDOW_DAYS = Math.min(45, Math.max(7, Number(process.env.FIXTURE_WINDOW_DAYS) || 21));
