/**
 * Starting-point language written to describe what this system actually does.
 * It is not legal advice and should be reviewed by an attorney before launch.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How ShotBreakdown handles your data.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[14px] font-medium text-text-0">{title}</h2>
      <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-text-1">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-10">
        <h1 className="text-[19px] font-medium text-text-0">Privacy Policy</h1>
        <p className="mb-10 mt-1 text-[12px] text-text-3">
          Last updated August 2026. Starting-point language pending legal review.
        </p>

        <div className="flex flex-col gap-8">
          <Section title="What we collect">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong className="text-text-0">Your email address</strong>, to sign you in and
                contact you about your account.
              </li>
              <li>
                <strong className="text-text-0">Videos and images you upload</strong>, plus the
                frames and metadata derived from them.
              </li>
              <li>
                <strong className="text-text-0">Your library activity</strong> — searches, saves,
                collections, corrections — recorded as product events so we can see what works. We
                store the search text you type, because knowing what people look for is how the
                library gets better.
              </li>
              <li>
                <strong className="text-text-0">Billing identifiers</strong> from Stripe if you
                subscribe. We never see or store your card details.
              </li>
            </ul>
            <p>
              We do not store IP addresses or user agents alongside product events, we do not use
              advertising trackers, and we do not sell data.
            </p>
          </Section>

          <Section title="Who processes it">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong className="text-text-0">Supabase</strong> — authentication, database and
                file storage. Your uploads live in a private bucket and are served only through
                short-lived signed URLs.
              </li>
              <li>
                <strong className="text-text-0">Anthropic</strong> — receives still frames extracted
                from your video, and the question text if you ask a follow-up. Your source video
                file is never sent.
              </li>
              <li>
                <strong className="text-text-0">OpenAI</strong> — receives the text of a shot record
                or a search query, to produce the vectors that power semantic search. No images.
              </li>
              <li>
                <strong className="text-text-0">Stripe</strong> — payment processing, if you
                subscribe.
              </li>
              <li>
                <strong className="text-text-0">Vercel</strong> — application hosting.
              </li>
            </ul>
          </Section>

          <Section title="Who can see your content">
            <p>
              Nobody, by default. Uploads are private to your account and enforced at the database
              level, not only in the interface. Sharing a link makes that item unlisted — reachable
              with the link, still hidden from the public library and from search. Only items you
              set public, or that an editor publishes, are visible to everyone.
            </p>
          </Section>

          <Section title="Deletion and your rights">
            <p>
              You can delete any video from its page, and your entire account from{" "}
              <Link href="/settings" className="text-accent hover:underline">
                Settings
              </Link>
              . Deleting a video permanently removes its source file, every extracted frame and
              every shot detected from it. Deleting your account does that for all your videos,
              cancels any subscription, removes your profile, collections, saved shots, share links
              and product events, and deletes the account itself.
            </p>
            <p>
              You can request a copy of your data by exporting any collection as JSON, or by
              contacting us. If you are in the EU or UK you have the usual rights of access,
              rectification, erasure and portability; the controls above implement most of them
              directly.
            </p>
          </Section>

          <Section title="Retention">
            <p>
              We keep your content until you delete it or your account. Product events are retained
              for up to 24 months and are unlinked from you when you delete your account. Backups
              rotate out within 30 days.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Privacy questions: <span className="mono text-text-0">privacy@shotbreakdown.app</span>
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
