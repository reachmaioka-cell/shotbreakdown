export async function register() {
  if (!process.env.SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}

export async function onRequestError(
  error: unknown,
  request: { path?: string },
  context: { routerKind?: string }
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(error, {
    extra: { path: request.path, routerKind: context.routerKind },
  });
}
