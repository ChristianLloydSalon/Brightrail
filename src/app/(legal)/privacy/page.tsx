import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import Link from "next/link";
import { LegalDoc, Mail, OPERATOR } from "../shared";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy Policy",
  description: "What personal data Brightrail collects, why, who it is shared with, how long it is kept, and your rights under the GDPR and the Philippine Data Privacy Act.",
  path: "/privacy",
  type: "article",
});

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      intro={
        <>
          <p>This policy explains what personal data Brightrail collects, why, who it is shared with, how long it is kept, and the rights you have over it.</p>
          <p className="mt-3 text-md text-fg-muted">Brightrail is a portfolio demo. Please don&rsquo;t send real customer data or other sensitive personal data through it.</p>
        </>
      }
    >
      <h2 id="who">1. Who we are</h2>
      <p>
        Brightrail (the &ldquo;Service&rdquo;) is a workflow automation platform operated by <strong>{OPERATOR}</strong>, an individual based in the Philippines
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). For your account data, we are the <strong>controller</strong> under the EU and UK General Data Protection Regulation (GDPR) and the
        personal information controller under the Philippine Data Privacy Act of 2012 (RA 10173). Contact us at <Mail /> about anything in this policy.
      </p>

      <h2 id="roles">2. Two kinds of data, two roles</h2>
      <ul>
        <li>
          <strong>Account data</strong>: who you are and how you use Brightrail (your profile, sign-in, membership, security logs). We decide how this is processed, so this policy applies directly.
        </li>
        <li>
          <strong>Workspace data</strong>: the workflows you build and the data that passes through them, such as webhook payloads, form submissions, records sent to Slack, Sheets or email, and the credentials you connect.
          Here the workspace owner is the controller, and we process the data only to run their workflows, as a <strong>processor</strong>.
          If your data reached Brightrail through someone else&rsquo;s workflow, contact that person first.
        </li>
      </ul>

      <h2 id="collect">3. What we collect</h2>
      <table>
        <thead><tr><th>Category</th><th>Examples</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>Identity and contact</td><td>Name, email address, optional job title</td><td>You, at sign-up and in your profile</td></tr>
          <tr><td>Sign-in data</td><td>Password (stored hashed by our auth provider), Google or GitHub account ID, name and email if you sign in with them, two-factor (TOTP) enrolment</td><td>You and the sign-in provider you choose</td></tr>
          <tr><td>Workspace and membership</td><td>Workspaces, roles, invitations, plan, settings, notification preferences, onboarding progress</td><td>You and your workspace admins</td></tr>
          <tr><td>Activity and audit</td><td>Audit log entries (who did what, when), approvals, API key metadata (keys are stored only as SHA-256 hashes)</td><td>Generated as you use the Service</td></tr>
          <tr><td>Workflow run data</td><td>Step inputs and outputs, error messages, logs. Secrets are removed and emails and phone numbers masked before storage; a workspace can choose to store no payload bodies at all</td><td>Your workflows and the systems they connect to</td></tr>
          <tr><td>Connector credentials</td><td>API keys, webhook URLs, service-account keys, encrypted with AES-256-GCM. Nobody can read them back through the app</td><td>You</td></tr>
          <tr><td>Technical data</td><td>IP address (used for rate limiting and held for about a day), request logs kept by our hosting provider, session cookies</td><td>Your browser and device</td></tr>
        </tbody>
      </table>
      <p>We do not use advertising, analytics or tracking tools, and we do not sell or rent personal data.</p>

      <h2 id="use">4. Why we use it, and our legal bases</h2>
      <table>
        <thead><tr><th>Purpose</th><th>Legal basis (GDPR Art. 6)</th></tr></thead>
        <tbody>
          <tr><td>Creating your account, signing you in, running your workflows, sending account and failure notification emails</td><td>Performance of our contract with you</td></tr>
          <tr><td>Security: two-factor authentication, rate limiting, abuse prevention, the audit log, investigating incidents</td><td>Our legitimate interest in keeping the Service and its users safe</td></tr>
          <tr><td>AI failure analysis, when a workspace turns it on (see section 5)</td><td>Performance of contract, on the workspace&rsquo;s instructions</td></tr>
          <tr><td>Answering your messages and requests</td><td>Legitimate interest, or a legal obligation when you exercise a legal right</td></tr>
          <tr><td>Complying with law and enforcing our <Link href="/terms">Terms</Link></td><td>Legal obligation; legitimate interest</td></tr>
        </tbody>
      </table>
      <p>We make no decisions about you based solely on automated processing that have legal or similarly significant effects.</p>

      <h2 id="ai">5. The AI assistant</h2>
      <p>
        If a workspace enables the AI exception assistant and a member asks for an analysis, we send <strong>sanitized evidence</strong> about the failed run to Google&rsquo;s Gemini API.
        This includes the workflow and step names, error codes and messages, and attempt history. We do not send credentials or raw payloads.
        Google processes this data under its Gemini API terms. Depending on the tier of service we use, Google may keep prompts and use them to improve its products, so do not put personal data in workflow or step names.
        The assistant only makes recommendations: a person must approve any action, and it can be turned off for each workspace in Settings.
      </p>

      <h2 id="share">6. Who we share it with</h2>
      <p>We share personal data only with the service providers we need to run Brightrail, and only for that purpose:</p>
      <table>
        <thead><tr><th>Provider</th><th>What they do</th><th>Location</th></tr></thead>
        <tbody>
          <tr><td>Vercel Inc.</td><td>Application hosting and request logs</td><td>United States and global edge network</td></tr>
          <tr><td>Supabase Inc.</td><td>Database, authentication, real-time updates</td><td>The region of our database project; may be outside your country</td></tr>
          <tr><td>Inngest Inc.</td><td>Durable background job execution (run and step identifiers, timing and step results)</td><td>United States</td></tr>
          <tr><td>Resend Inc.</td><td>Account and notification emails</td><td>United States</td></tr>
          <tr><td>Google LLC</td><td>Gemini AI analysis (optional); Google sign-in if you use it</td><td>United States and global</td></tr>
          <tr><td>GitHub Inc.</td><td>GitHub sign-in, if you use it</td><td>United States</td></tr>
        </tbody>
      </table>
      <p>
        When your workflows send data to services you connect, such as Slack, Discord, Microsoft Teams, Telegram, Google Sheets, Notion, Airtable, Resend or any HTTPS endpoint,
        that transfer happens because you or your workspace told it to, and those services handle the data under their own terms.
        Members of your workspace can see the data their role allows. We may also disclose data when the law requires it, or to protect the rights and safety of users or the public.
      </p>

      <h2 id="transfers">7. International transfers</h2>
      <p>
        We are based in the Philippines and our providers process data in the United States and elsewhere. When personal data from the European Economic Area, the UK or Switzerland is transferred
        to a country without an adequacy decision, we rely on the safeguards our providers offer, such as the European Commission&rsquo;s Standard Contractual Clauses or the EU&ndash;US Data Privacy Framework where a provider is certified.
      </p>

      <h2 id="retention">8. How long we keep it</h2>
      <ul>
        <li><strong>Account and profile data:</strong> until you delete your account, or earlier if the demo is reset (see the <Link href="/terms">Terms</Link>).</li>
        <li><strong>Workflow runs, step payloads, logs and webhook delivery records:</strong> deleted automatically after the period the workspace chooses (7, 14, 30 or 90 days). Runs still in progress are kept until they finish.</li>
        <li><strong>In-app notifications:</strong> 90 days.</li>
        <li><strong>Rate-limit records, which include IP addresses:</strong> about one day.</li>
        <li><strong>Audit log:</strong> for the life of the workspace. Deleting the workspace deletes it.</li>
        <li><strong>Workspaces, workflows and credentials:</strong> until the workspace is deleted. Revoked credentials are removed on revocation.</li>
        <li><strong>Backups and provider logs:</strong> our providers may keep copies for a short period under their own retention schedules before they are overwritten.</li>
      </ul>

      <h2 id="rights">9. Your rights</h2>
      <p>Depending on where you live, you have the right to:</p>
      <ul>
        <li><strong>Access</strong> your personal data and receive a copy;</li>
        <li><strong>Rectify</strong> inaccurate data. You can edit most of it in Settings &rarr; Profile;</li>
        <li><strong>Erase</strong> your data. You can delete your account in Settings &rarr; Profile, and owners can delete a whole workspace;</li>
        <li><strong>Restrict</strong> or <strong>object</strong> to processing based on legitimate interests;</li>
        <li><strong>Data portability</strong>: receive the data you gave us in a structured, machine-readable format;</li>
        <li><strong>Withdraw consent</strong> where processing relies on it, without affecting earlier processing;</li>
        <li><strong>Lodge a complaint</strong> with a supervisory authority: in the EU or UK, the data protection authority where you live or work; in the Philippines, the <a href="https://privacy.gov.ph" rel="noopener noreferrer" target="_blank">National Privacy Commission</a>.</li>
      </ul>
      <p>
        Under the Philippine Data Privacy Act you also have the right to be informed, which this policy fulfils, and the right to damages for inaccurate, incomplete, outdated, false or unlawfully obtained data.
        To exercise any right, email <Mail />. We will confirm your identity, usually by replying to your account email, and respond within one month.
        For workspace data, we will pass your request to the workspace owner and help them respond.
      </p>

      <h2 id="security">10. Security</h2>
      <p>
        We protect data with encryption in transit (HTTPS) and at rest. Connector credentials and webhook secrets get an extra layer of AES-256-GCM encryption.
        We also use database row-level security that isolates each workspace, optional TOTP two-factor authentication, hashed API keys, payload redaction, outbound request protections and an append-only audit log.
        No system is perfectly secure. If a breach affects your personal data, we will notify you and the relevant authorities as the law requires.
      </p>

      <h2 id="cookies">11. Cookies and local storage</h2>
      <p>We use only what the Service needs to work. You don&rsquo;t need to consent to these, but blocking them will stop you from signing in.</p>
      <table>
        <thead><tr><th>Name</th><th>Purpose</th><th>Duration</th></tr></thead>
        <tbody>
          <tr><td>Supabase auth cookies (<code>sb-*</code>)</td><td>Keep you signed in</td><td>Session, refreshed while you use the Service</td></tr>
          <tr><td><code>ff_ws</code></td><td>Remembers which workspace you last opened</td><td>1 year</td></tr>
          <tr><td><code>brightrail-prefs</code> (local storage)</td><td>Interface preferences such as theme; stays on your device</td><td>Until you clear it</td></tr>
        </tbody>
      </table>

      <h2 id="children">12. Children</h2>
      <p>Brightrail is a business tool and is not intended for anyone under 16. We do not knowingly collect children&rsquo;s data. If you believe a child has given us personal data, contact us and we will delete it.</p>

      <h2 id="changes">13. Changes to this policy</h2>
      <p>If we change this policy, we will update the effective date above. We will tell signed-in users about material changes by email or in the app before they take effect.</p>

      <h2 id="contact">14. Contact</h2>
      <p>{OPERATOR}, operator of Brightrail &middot; <Mail /></p>
    </LegalDoc>
  );
}
