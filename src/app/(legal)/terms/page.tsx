import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import Link from "next/link";
import { LegalDoc, Mail, OPERATOR } from "../shared";

export const metadata: Metadata = publicPageMetadata({
  title: "Terms of Service",
  description: "The terms for using Brightrail, a free portfolio demo of a workflow automation platform: acceptable use, your content, warranty and liability, and governing law.",
  path: "/terms",
  type: "article",
});

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      intro={<p>Brightrail is a free portfolio demo run by {OPERATOR}. By creating an account or using it, you agree to these terms.</p>}
    >
      <h2 id="demo">1. It&rsquo;s a demo</h2>
      <p>
        Brightrail shows off a workflow automation platform. It is not a commercial product. It has no uptime guarantee and no support commitment.
        Accounts, workspaces and data may be reset or deleted at any time, with or without notice. Don&rsquo;t connect it to production systems, and don&rsquo;t rely on it for anything important.
      </p>

      <h2 id="use">2. Acceptable use</h2>
      <p>Don&rsquo;t use Brightrail to:</p>
      <ul>
        <li>break the law or infringe anyone&rsquo;s rights;</li>
        <li>send spam, phishing or unsolicited messages;</li>
        <li>scan, attack or overload any system, including through HTTP steps or webhooks;</li>
        <li>get around rate limits or security controls, or access other people&rsquo;s workspaces;</li>
        <li>process real customer data or sensitive personal data.</li>
      </ul>
      <p>We may suspend or delete accounts and workflows that misuse the Service.</p>

      <h2 id="content">3. Your content</h2>
      <p>
        You keep ownership of your workflows and the data you put into Brightrail. You let us store and process them only to run the Service.
        You are responsible for the credentials you connect and for following the terms of the services your workflows talk to.
        AI suggestions can be wrong, and you are responsible for the actions you approve. Our <Link href="/privacy">Privacy Policy</Link> explains how we handle personal data.
      </p>

      <h2 id="liability">4. No warranty, limited liability</h2>
      <p>
        The Service is provided <strong>&ldquo;as is&rdquo;</strong>, without warranties of any kind. As far as the law allows, we are not liable for any loss arising from your use of the Service.
        That includes failed, duplicated or delayed workflow runs, lost data, and anything done by third-party services. Nothing here limits liability that the law does not allow us to limit.
      </p>

      <h2 id="general">5. Changes, law and contact</h2>
      <p>
        We may update these terms and will change the effective date when we do. These terms are governed by the laws of the Philippines.
        The source code is available separately under the MIT License. You can delete your account at any time in Settings &rarr; Profile. Questions: <Mail />.
      </p>
    </LegalDoc>
  );
}
