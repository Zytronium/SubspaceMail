import { Link } from 'react-router-dom'

export function Privacy() {
  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 nav-blur">
        <nav className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 text-text-primary no-underline">
            <img src="/logo-transparent.png" alt="Subspace Mail" className="w-7 h-7 rounded-md" />
            <span className="font-semibold text-lg tracking-tight">Subspace Mail</span>
          </Link>
          <Link to="/" className="text-sm text-text-secondary hover:text-text-primary transition-colors no-underline">
            ← Back to home
          </Link>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-24 pb-20">
        <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-2 text-text-primary">
          Privacy Policy
        </h1>
        <p className="text-text-muted text-sm mb-10">Last updated: November 2025</p>

        <section className="mb-10">
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail is a free, open-source desktop email client. We believe your email is
            private, and our software is designed to keep it that way. This policy explains how
            Subspace Mail handles your data.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            <strong className="text-text-primary">Short version:</strong> Subspace Mail does not
            collect, transmit, or store any of your data on external servers. Everything stays on
            your machine. There is no account system, no analytics, and no tracking.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            What We Do Not Do
          </h2>
          <ul className="space-y-3 text-text-secondary leading-relaxed">
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">No telemetry or analytics.</strong> Subspace
                Mail does not send usage data, crash reports, or diagnostics to any server.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">No tracking.</strong> There are no cookies,
                pixels, fingerprinting scripts, or advertising identifiers.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">No cloud storage.</strong> Subspace Mail has
                no backend servers. We do not operate any infrastructure that receives your data.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">No account required.</strong> You do not
                create an account with Subspace Mail. The application works entirely offline once
                installed.
              </span>
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Where Your Data Lives
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            All of your data — emails, contacts, calendar events, settings, and credentials — is
            stored locally on your device in a SQLite database. This database lives in your
            application data directory and is accessible only to Subspace Mail on your machine.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            Sensitive credentials (OAuth tokens, IMAP/SMTP passwords) are encrypted with
            AES-256-GCM before being written to the local database.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Connections to Email Providers
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail connects directly to your email provider's servers (e.g., Gmail via the
            Gmail REST API with OAuth 2.0, or any IMAP/SMTP provider). These connections are
            encrypted with TLS. Subspace Mail does not intercept, log, or forward the content of
            these connections.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            Your email provider's own privacy policy governs how they handle your data on their
            end. Subspace Mail is merely the client that displays and manages your email.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            AI Features (Optional)
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail offers optional AI features such as thread summaries, smart replies, and
            natural language inbox search. These features require you to provide your own API key
            for a third-party AI provider (e.g., Anthropic Claude, OpenAI, Google Gemini, or a
            local Ollama instance).
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            When you use AI features, selected email content (such as subjects, snippets, or
            thread text) is sent directly to the AI provider you configured — not through any
            Subspace Mail server. The AI provider's privacy policy applies to that data.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            If you do not configure an AI provider, no data leaves your machine for AI purposes.
            AI features are entirely optional and disabled by default.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Other Third-Party Services
          </h2>
          <ul className="space-y-3 text-text-secondary leading-relaxed">
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">Gravatar</strong> — Contact avatars may be
                fetched from Gravatar based on email addresses in your contacts.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">Google Calendar</strong> — If you enable
                calendar integration, Subspace Mail connects directly to Google Calendar APIs using
                your OAuth credentials.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent mt-1.5 shrink-0">•</span>
              <span>
                <strong className="text-text-primary">CalDAV</strong> — Calendar sync with CalDAV
                servers connects directly to your configured server.
              </span>
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Email Rendering & Security
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            HTML emails are sanitized with DOMPurify and rendered in sandboxed iframes. Remote
            images are blocked by default — you must explicitly allow images from specific senders.
            Phishing detection heuristics flag suspicious links before you click them.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Open Source
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail is fully open source under the Apache 2.0 license. You can verify
            everything in this policy by reading the source code at{' '}
            <a
              href="https://github.com/Zytronium/SubspaceMail"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover underline"
            >
              GitHub
            </a>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Updates to This Policy
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            If we ever change this policy, the update will be committed to the public repository
            and noted in the release changelog.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium text-text-primary mb-4">Contact</h2>
          <p className="text-text-secondary leading-relaxed">
            For privacy-related questions, please open an issue at{' '}
            <a
              href="https://github.com/Zytronium/SubspaceMail/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover underline"
            >
              GitHub Issues
            </a>
            .
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo-transparent.png" alt="Subspace Mail" className="w-5 h-5 rounded" />
            <span className="text-sm text-text-muted">Subspace Mail</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            <a
              href="https://github.com/Zytronium/SubspaceMail"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors no-underline"
            >
              GitHub
            </a>
            <Link to="/privacy" className="hover:text-text-secondary transition-colors no-underline">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-text-secondary transition-colors no-underline">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
