import { permanentRedirect } from "next/navigation";

/** "History" became the videos list once one upload started producing many shots. */
export function GET() {
  permanentRedirect("/videos");
}
