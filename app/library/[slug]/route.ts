import { permanentRedirect } from "next/navigation";

/**
 * The library used to live at /library/[slug] with one breakdown per page.
 * Those slugs were carried onto the shot rows, so existing links and any
 * indexed URLs move permanently to the shot page rather than 404ing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  permanentRedirect(`/shots/${slug}`);
}
