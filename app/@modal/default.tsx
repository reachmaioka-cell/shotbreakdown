/**
 * The modal slot renders nothing for every route that is not an intercepted
 * shot. Without this file a hard navigation to any other route has no match for
 * the slot and Next.js 404s the whole page.
 */
export default function Default() {
  return null;
}
