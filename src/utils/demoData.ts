import type { Account } from "@/stores/accountStore";
import type { Thread } from "@/stores/threadStore";

// Deterministic seed-based random for reproducible demo data
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const rand = seededRandom(42);

const firstNames = [
  "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank",
  "Iris", "Jack", "Karen", "Leo", "Mia", "Noah", "Olivia", "Paul",
  "Quinn", "Rachel", "Sam", "Tina", "Uma", "Victor", "Wendy", "Xander",
];

const lastNames = [
  "Anderson", "Brown", "Clark", "Davis", "Evans", "Foster", "Garcia",
  "Harris", "Ivanov", "Johnson", "Kim", "Lee", "Martinez", "Nguyen",
  "O'Brien", "Patel", "Quinn", "Roberts", "Smith", "Taylor", "Ueda",
  "Vasquez", "Wilson", "Xu",
];

const domains = ["example.com", "maildemo.org", "testinbox.net", "demomail.io"];

const subjects = [
  "Q4 Planning Meeting — Action Items",
  "Re: Project Timeline Update",
  "Welcome to the team! 🎉",
  "Invoice #2024-0892 — Payment Received",
  "Your weekly digest is here",
  "FW: Conference Talk Proposal",
  "Re: Design Review Feedback",
  "Shipping notification: Order #48291",
  "Reminder: Team standup at 10 AM",
  "Re: Budget Approval Request",
  "New feature announcement: Dark Mode",
  "Password reset request",
  "Re: Client Onboarding Checklist",
  "Meeting notes: Sprint Retrospective",
  "Your subscription renewal is coming up",
  "Re: API Rate Limit Changes",
  "Invitation: Product Demo Session",
  "Security alert: New login detected",
  "Re: Contract Renewal Discussion",
  "Holiday schedule — Office closures",
  "Re: Database Migration Plan",
  "Newsletter: Top 10 Developer Tools",
  "Re: Code Review — PR #342",
  "Your monthly statement is ready",
  "Team outing — RSVP by Friday",
  "Re: Incident Report #128",
  "Update: Server maintenance window",
  "Re: Marketing Campaign Results",
  "Training session: Security best practices",
  "Re: Hiring — Senior Engineer Role",
  "Re: Feedback on the new dashboard",
  "Your calendar invite: 1:1 Sync",
  "Re: Vendor Comparison Matrix",
  "System update: v2.4.1 released",
  "Re: Data Export Request",
  "Lunch & Learn: AI in Email",
  "Re: Performance Optimization",
  "Account verification required",
  "Re: Partnership Opportunity",
  "Weekly report: Key metrics summary",
];

const snippets = [
  "Hi team, I've attached the updated timeline for Q4. Please review and let me know if there are any conflicts with your current schedule...",
  "Thanks for the feedback! I've made the changes you suggested. Could you take another look when you have a moment?",
  "We're excited to have you on board! Here's everything you need to get started with your first week...",
  "Your payment of $249.00 has been processed successfully. You can find the receipt attached to this email...",
  "This week's highlights include new features, community updates, and upcoming events you won't want to miss...",
  "I've forwarded the proposal from the conference organizers. Let me know if you'd like to submit a talk...",
  "The design review went well overall. Here are the key points we discussed and the action items...",
  "Your order has shipped and is expected to arrive by November 20th. Track your package using the link below...",
  "Just a quick reminder that our daily standup is at 10 AM in the main conference room...",
  "The budget request has been reviewed. Here's the breakdown of approved items and next steps...",
  "We're thrilled to announce that dark mode is now available in all plans. Toggle it in your settings...",
  "We received a password reset request for your account. If this was you, click the link below...",
  "Here's the updated onboarding checklist for the new client. Please ensure all items are completed by EOD...",
  "Attached are the notes from today's retrospective. Key takeaways include improving our CI pipeline...",
  "Your subscription renews on December 1st. Update your payment method or change plan before then...",
  "Heads up: we're adjusting API rate limits next month. Here's what you need to know...",
  "You're invited to our product demo session next Tuesday. RSVP here to reserve your spot...",
  "We detected a new login to your account from a Chrome browser on macOS. If this wasn't you...",
  "I've reviewed the contract terms. Let's schedule a call to discuss the renewal details...",
  "Please note the following office closures during the holiday season. Plan accordingly...",
  "The database migration is scheduled for this weekend. Expected downtime is approximately 2 hours...",
  "Check out our curated list of the top developer tools for 2024, from debugging to deployment...",
  "I've left comments on the PR. Overall the approach looks solid, just a few minor suggestions...",
  "Your monthly statement for October is now available. Log in to view the full breakdown...",
  "We're organizing a team outing next month. Please RSVP by Friday so we can finalize reservations...",
  "The incident has been resolved. Here's a post-mortem summary and the steps we're taking to prevent recurrence...",
  "Scheduled maintenance will take place on Saturday from 2 AM to 6 AM UTC. Services may be intermittently unavailable...",
  "The Q3 marketing campaign exceeded expectations. Here are the key metrics and learnings...",
  "The security training session is mandatory for all team members. Register through the link below...",
  "We're looking for a Senior Engineer to join the platform team. Refer someone you know...",
  "Thanks for trying the new dashboard! We'd love to hear your thoughts on the layout and features...",
  "You have a 1:1 sync scheduled for tomorrow at 2 PM. Please prepare your updates in advance...",
  "I've compiled the vendor comparison matrix. The top three options are highlighted in green...",
  "Version 2.4.1 is now live with bug fixes and performance improvements. See the changelog for details...",
  "Your data export is ready for download. The file will be available for 48 hours...",
  "Join us for a lunch and learn session on AI-powered email features. Pizza provided!",
  "The performance optimization work is 80% complete. We're seeing a 30% improvement in load times...",
  "For your security, please verify your account by clicking the button below...",
  "We'd like to explore a potential partnership. Are you available for a brief call next week?",
  "This week's key metrics: 12% increase in user engagement, 5% reduction in churn rate...",
];

const emailBodies = [
  `<div><p>Hi team,</p><p>I've attached the updated timeline for Q4. Please review and let me know if there are any conflicts with your current schedule. We need to finalize this by end of week so we can present to stakeholders on Monday.</p><p>Best regards,<br>Alice</p></div>`,
  `<div><p>Thanks for the feedback! I've made the changes you suggested. Could you take another look when you have a moment?</p><p>The main changes are:</p><ul><li>Updated the color scheme</li><li>Revised the navigation flow</li><li>Added the new dashboard widgets</li></ul><p>Let me know what you think.</p></div>`,
  `<div><p>We're excited to have you on board! Here's everything you need to get started with your first week.</p><p><strong>Day 1:</strong> Orientation and team introductions<br><strong>Day 2:</strong> Codebase walkthrough<br><strong>Day 3:</strong> First sprint planning</p><p>Don't hesitate to reach out if you have any questions.</p></div>`,
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function randomEmail(): string {
  const first = randomFrom(firstNames).toLowerCase();
  const last = randomFrom(lastNames).toLowerCase();
  const domain = randomFrom(domains);
  const patterns = [
    `${first}.${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}_${last}@${domain}`,
  ];
  return randomFrom(patterns);
}

function randomName(): string {
  return `${randomFrom(firstNames)} ${randomFrom(lastNames)}`;
}

function randomDate(base: Date, rangeDays: number): Date {
  const offset = rand() * rangeDays * 24 * 60 * 60 * 1000;
  return new Date(base.getTime() - offset);
}

export interface DemoAccount extends Account {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isActive: boolean;
  provider?: string;
}

export function generateDemoAccounts(): DemoAccount[] {
  return [
    {
      id: "demo-account-1",
      email: "alice.anderson@example.com",
      displayName: "Alice Anderson",
      avatarUrl: null,
      isActive: true,
      provider: "gmail",
    },
    {
      id: "demo-account-2",
      email: "bob.brown@maildemo.org",
      displayName: "Bob Brown",
      avatarUrl: null,
      isActive: true,
      provider: "gmail",
    },
  ];
}

export function generateDemoThreads(accountId: string): Thread[] {
  const now = Date.now();
  const threads: Thread[] = [];
  const labels = ["INBOX", "SENT", "DRAFT", "STARRED"];

  for (let i = 0; i < 30; i++) {
    const date = randomDate(new Date(now), 30);
    const fromEmail = randomEmail();
    const fromName = randomName();
    const subject = randomFrom(subjects);
    const snippet = randomFrom(snippets);
    const labelPool = i < 20 ? ["INBOX"] : [randomFrom(labels)];

    threads.push({
      id: `demo-thread-${accountId}-${i}`,
      accountId,
      subject,
      snippet,
      lastMessageAt: date.getTime(),
      messageCount: Math.floor(rand() * 5) + 1,
      isRead: rand() > 0.3,
      isStarred: rand() > 0.8,
      isPinned: i < 3,
      isMuted: rand() > 0.9,
      hasAttachments: rand() > 0.6,
      labelIds: labelPool,
      fromName,
      fromAddress: fromEmail,
    });
  }

  // Sort by date descending, pinned first
  threads.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.lastMessageAt - a.lastMessageAt;
  });

  return threads;
}

/** Generate a fake email body for a thread, used when opening a thread in demo mode */
export function generateDemoEmailBody(threadId: string): string {
  const idx = parseInt(threadId.split("-").pop() ?? "0", 10);
  return emailBodies[idx % emailBodies.length] ?? emailBodies[0]!;
}

/** Check if an ID belongs to demo data */
export function isDemoAccountId(id: string): boolean {
  return id.startsWith("demo-account-");
}

export function isDemoThreadId(id: string): boolean {
  return id.startsWith("demo-thread-");
}
