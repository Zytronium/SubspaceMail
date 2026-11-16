import { Link } from 'react-router-dom'

export function Terms() {
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
          Terms of Use
        </h1>
        <p className="text-text-muted text-sm mb-10">Last updated: November 2025</p>

        <section className="mb-10">
          <p className="text-text-secondary leading-relaxed mb-4">
            These terms govern your use of the Subspace Mail desktop application ("the
            Application"). Subspace Mail is a free, open-source project released under the Apache
            2.0 license.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            License
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail is licensed under the Apache License 2.0. By using, modifying, or
            distributing this software, you agree to the terms of that license. A copy of the
            license is available in the{' '}
            <a
              href="https://github.com/Zytronium/SubspaceMail/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover underline"
            >
              repository
            </a>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            No Account or Registration
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail does not require you to create an account, provide personal information,
            or register in any way. The application is designed to work entirely on your local
            machine.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Your Email Accounts
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            When you connect your email accounts (Gmail, IMAP/SMTP, etc.) to Subspace Mail, you
            are responsible for managing the permissions and credentials you grant. Subspace Mail
            uses OAuth 2.0 for Gmail and standard IMAP/SMTP authentication for other providers.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            We are not responsible for any actions taken on your email accounts, nor for any
            issues arising from your email provider's terms of service, rate limits, or account
            restrictions.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            AI Features
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            If you use the optional AI features, you are responsible for providing your own API
            keys and for any costs associated with third-party AI services (Anthropic, OpenAI,
            Google, etc.). Subspace Mail does not manage, bill for, or guarantee the availability
            of these services.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            AI-generated content (summaries, replies, etc.) is produced by third-party models.
            Subspace Mail does not guarantee the accuracy, completeness, or appropriateness of
            AI-generated output. Always review AI suggestions before sending.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            No Warranty
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            Subspace Mail is provided "as is" without warranty of any kind, express or implied,
            including but not limited to warranties of merchantability, fitness for a particular
            purpose, and non-infringement. See the Apache 2.0 license for full details.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            The authors and contributors shall not be liable for any claims, damages, or other
            liability arising from the use of the software.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Contributions
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            If you contribute code, documentation, or other content to the Subspace Mail
            repository, your contributions are made under the Apache 2.0 license. By submitting a
            pull request, you agree that your contribution will be licensed accordingly.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-medium text-text-primary mb-4">
            Changes to These Terms
          </h2>
          <p className="text-text-secondary leading-relaxed mb-4">
            These terms may be updated at any time. Changes will be committed to the public
            repository and noted in the release changelog.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-medium text-text-primary mb-4">Contact</h2>
          <p className="text-text-secondary leading-relaxed">
            For questions about these terms, please open an issue at{' '}
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
