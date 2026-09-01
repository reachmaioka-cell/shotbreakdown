/**
 * Central error reporting. Always logs. When SENTRY_DSN is set, also forwards
 * to Sentry. Never include secrets in `context`.
 */
export function reportError(
  error: unknown,
  context: Record<string, string | number | boolean | undefined> = {}
): void {
  const message = error instanceof Error ? error.message : String(error);
  const source = context.source ?? "error";
  console.error(source, message, context);

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        extra: context,
        tags: { source: String(source) },
      });
    })
    .catch(() => {
      // SDK missing or not initialised — the console.error above still fired.
    });
}
