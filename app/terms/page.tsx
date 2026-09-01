/**
 * Starting-point language written to describe what this system actually does.
 * It is not legal advice and should be reviewed by an attorney before launch.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using ShotBreakdown.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[14px] font-medium text-text-0">{title}</h2>
      <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-text-1">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-10">
        <h1 className="text-[19px] font-medium text-text-0">Terms of Service</h1>
        <p className="mb-10 mt-1 text-[12px] text-text-3">
          Last updated August 2026. Starting-point language pending legal review.
        </p>

        <div className="flex flex-col gap-8">
          <Section title="What the service does">
            <p>
              ShotBreakdown analyzes video you provide. It detects shot boundaries, extracts frames,
              and uses AI models to describe the cinematography of each shot. The result is stored
              in your account and indexed so you can search it.
            </p>
            <p>
              You sign in with an email magic link. There is no password to lose.
            </p>
          </Section>

          <Section title="Content you upload">
            <p>
              You keep ownership of everything you upload. You grant us only the permission needed
              to run the service: to store your files, generate frames and derived metadata from
              them, and show them back to you and to anyone you deliberately share them with.
            </p>
            <p>
              <strong className="text-text-0">You are responsible for having the right to upload
              what you upload.</strong> Do not upload material you do not own or have permission to
              use, and do not use ShotBreakdown to redistribute someone else&apos;s work. If you are
              analyzing third-party footage as a reference, keep it private.
            </p>
            <p>
              We remove content and may suspend accounts in response to a valid infringement
              complaint, and for material that is unlawful or that we are required to remove.
            </p>
          </Section>

          <Section title="AI processing and accuracy">
            <p>
              Frames extracted from your video are sent to third-party AI providers (Anthropic for
              analysis, OpenAI for search embeddings) to produce the shot record. Your source video
              file itself is not sent to them — only still frames.
            </p>
            <p>
              <strong className="text-text-0">The analysis is an interpretation of an image, not a
              record of how the shot was made.</strong> Focal length, aperture, sensor format and
              lens character cannot be measured from a picture; they are estimates and are labelled
              as such throughout the product. Do not rely on them as production data. You can
              correct any field.
            </p>
          </Section>

          <Section title="Public content">
            <p>
              Your uploads are private by default. Sharing a link makes that item unlisted:
              reachable by anyone with the link, still absent from the public library and from
              search. Items only become public if you set them public or an editor publishes them,
              and you can revoke a share link at any time.
            </p>
          </Section>

          <Section title="Deletion">
            <p>
              Deleting a video permanently removes the source file, every extracted frame and every
              shot detected from it — including shots that were added to collections or saved by
              other users. Deleting your account does the same for all of your videos and removes
              the account. Neither is reversible, and neither is a soft delete.
            </p>
            <p>
              Backups may retain data for a short period before rotating out.
            </p>
          </Section>

          <Section title="Plans and payment">
            <p>
              Free and Pro plans have limits on how many videos you can analyze, how long they can
              be, and which features are available. Limits are enforced on the server. Paid plans
              are billed through Stripe and can be cancelled at any time from Settings; cancelling
              stops future charges and does not refund the current period.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>
              Do not attempt to access other users&apos; data, circumvent limits, scrape the library
              at scale, or use the service to build a competing dataset. We rate-limit and may
              suspend accounts that do.
            </p>
          </Section>

          <Section title="No warranty">
            <p>
              The service is provided as is. AI output may be wrong. Processing may fail. We do not
              guarantee availability, and our liability is limited to the amount you have paid us in
              the previous twelve months, to the extent the law allows.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We will update this page when the service changes materially. Continuing to use
              ShotBreakdown after a change means you accept it.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms, or an infringement complaint, can be sent to the address
              listed in the{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
