/**
 * emailStore.ts — Zustand store for the Onyx Email Client.
 * Manages accounts, unified inbox, categories, draft queue, spam rules,
 * keyboard navigation, and undo-send timers.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ─── Types ──────────────────────────────────────────────────── */

export interface EmailAccount {
    id: string;
    email: string;
    displayName: string;
    provider: 'Gmail' | 'Microsoft' | 'Custom';
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    authMethod: 'oauth2' | 'password';
    accessToken?: string;
    refreshToken?: string;
    password?: string;
    clientId?: string;
}

export interface EmailHeader {
    uid: number;
    from: string;
    to: string;
    subject: string;
    date: string;
    preview: string;
    is_read: boolean;
    has_attachments: boolean;
    message_id: string;
    in_reply_to: string | null;
    references: string[];
    // Client-side additions
    accountId?: string;
    category?: EmailCategory;
}

export interface EmailBody {
    uid: number;
    html: string | null;
    text: string | null;
    attachments: EmailAttachment[];
}

export interface EmailAttachment {
    filename: string;
    mime_type: string;
    size: number;
    data: string;
}

export interface SpamAnalysis {
    score: number;
    is_spam: boolean;
    reasons: SpamReason[];
    spf_pass: boolean;
    dkim_pass: boolean;
    dmarc_pass: boolean;
    has_unsubscribe: boolean;
    unsubscribe_url: string | null;
    list_unsubscribe: string | null;
}

export interface SpamReason {
    name: string;
    score: number;
    description: string;
}

export interface QueuedDraft {
    id: string;
    accountId: string;
    to: string[];
    cc: string[];
    subject: string;
    bodyHtml: string;
    bodyText: string;
    inReplyTo?: string;
    references?: string;
    scheduledAt: number; // timestamp when to actually send
    createdAt: number;
    attachments?: DraftAttachment[];
    recurring?: {
        cron: string;
        nextRun: number;
    };
}

export interface DraftAttachment {
    filename: string;
    mimeType: string;
    dataBase64: string; // base64 encoded file content
}

export type EmailCategory = 'all' | 'personal' | 'newsletters' | 'transactional' | 'spam';

export interface EmailThread {
    id: string;
    subject: string;
    emails: EmailHeader[];
    lastDate: string;
    unreadCount: number;
    accountId: string;
    category: EmailCategory;
}

/* ─── Category Detection ─────────────────────────────────────── */

const TRANSACTIONAL_KEYWORDS = [
    'otp', 'verification', 'verify', 'code', 'confirm', 'receipt', 'invoice',
    'order', 'shipping', 'delivery', 'tracking', 'payment', 'transaction',
    'password reset', 'security alert', 'sign in', 'login', 'authentication',
    'two-factor', '2fa', 'bank', 'statement', 'billing',
];

const NEWSLETTER_KEYWORDS = [
    'unsubscribe', 'newsletter', 'digest', 'weekly', 'monthly', 'update',
    'promotion', 'deal', 'offer', 'sale', 'discount', 'promo',
    'list-unsubscribe', 'bulk', 'marketing', 'campaign',
];

export function categorizeEmail(email: EmailHeader): EmailCategory {
    const text = `${email.subject} ${email.from} ${email.preview}`.toLowerCase();

    // Spam detection (client-side heuristics)
    const spamPatterns = ['viagra', 'casino', 'lottery', 'winner', 'click here now', 'act now', 'limited time'];
    const spamScore = spamPatterns.reduce((s, p) => s + (text.includes(p) ? 3 : 0), 0);
    if (spamScore >= 6) return 'spam';

    // Transactional
    const txScore = TRANSACTIONAL_KEYWORDS.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (txScore >= 2) return 'transactional';

    // Newsletter
    const nlScore = NEWSLETTER_KEYWORDS.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (nlScore >= 2) return 'newsletters';

    return 'personal';
}

/* ─── Store ──────────────────────────────────────────────────── */

interface EmailState {
    // Accounts
    accounts: EmailAccount[];
    activeAccountId: string | null;

    // Inbox
    unifiedInbox: EmailHeader[];
    activeFolder: string;
    activeCategory: EmailCategory;
    selectedEmailUid: number | null;
    selectedEmailBody: EmailBody | null;
    selectedSpamAnalysis: SpamAnalysis | null;
    selectedIndex: number; // for keyboard nav

    // State flags
    loading: boolean;
    loadingBody: boolean;
    refreshing: boolean;
    searchQuery: string;

    // Draft queue (undo send)
    draftQueue: QueuedDraft[];

    // Spam rules (trainable)
    whitelistedSenders: string[];
    blacklistedSenders: string[];

    // Known contacts (auto-collected from emails)
    knownContacts: string[];

    // Compose
    composeOpen: boolean;
    replyToEmail: EmailHeader | null;

    // Setup modal
    setupOpen: boolean;

    // Actions
    setAccounts: (accounts: EmailAccount[]) => void;
    addAccount: (account: EmailAccount) => void;
    removeAccount: (id: string) => void;
    setActiveAccountId: (id: string | null) => void;
    setActiveFolder: (folder: string) => void;
    setActiveCategory: (category: EmailCategory) => void;
    setUnifiedInbox: (emails: EmailHeader[]) => void;
    appendToInbox: (emails: EmailHeader[], accountId: string) => void;
    setSelectedEmail: (uid: number | null) => void;
    setSelectedEmailBody: (body: EmailBody | null) => void;
    setSelectedSpamAnalysis: (analysis: SpamAnalysis | null) => void;
    setSelectedIndex: (index: number) => void;
    setLoading: (loading: boolean) => void;
    setLoadingBody: (loading: boolean) => void;
    setRefreshing: (refreshing: boolean) => void;
    setSearchQuery: (query: string) => void;
    setComposeOpen: (open: boolean) => void;
    setReplyToEmail: (email: EmailHeader | null) => void;
    setSetupOpen: (open: boolean) => void;

    // Draft queue
    addDraft: (draft: QueuedDraft) => void;
    removeDraft: (id: string) => void;
    getDraftById: (id: string) => QueuedDraft | undefined;

    // Spam rules
    whitelistSender: (sender: string) => void;
    blacklistSender: (sender: string) => void;
    removeFromWhitelist: (sender: string) => void;
    removeFromBlacklist: (sender: string) => void;

    // Contacts
    getContactSuggestions: (query: string) => string[];

    // Computed
    getFilteredEmails: () => EmailHeader[];
    getActiveAccount: () => EmailAccount | null;
    getAccountById: (id: string) => EmailAccount | undefined;
}

export const useEmailStore = create<EmailState>()(
    persist(
        (set, get) => ({
            // Initial state
            accounts: [],
            activeAccountId: null,
            unifiedInbox: [],
            activeFolder: 'INBOX',
            activeCategory: 'all',
            selectedEmailUid: null,
            selectedEmailBody: null,
            selectedSpamAnalysis: null,
            selectedIndex: -1,
            loading: false,
            loadingBody: false,
            refreshing: false,
            searchQuery: '',
            draftQueue: [],
            whitelistedSenders: [],
            blacklistedSenders: [],
            knownContacts: [],
            composeOpen: false,
            replyToEmail: null,
            setupOpen: false,

            // Account management
            setAccounts: (accounts) => set({ accounts }),
            addAccount: (account) => set((s) => ({
                accounts: [...s.accounts, account],
                activeAccountId: s.activeAccountId || account.id,
            })),
            removeAccount: (id) => set((s) => {
                const remaining = s.accounts.filter(a => a.id !== id);
                return {
                    accounts: remaining,
                    activeAccountId: s.activeAccountId === id
                        ? (remaining[0]?.id || null)
                        : s.activeAccountId,
                    unifiedInbox: s.unifiedInbox.filter(e => e.accountId !== id),
                };
            }),
            setActiveAccountId: (id) => set({ activeAccountId: id }),
            setActiveFolder: (folder) => set((state) => {
                if (state.activeFolder === folder) return {}; // no-op: same folder click
                return { activeFolder: folder, selectedEmailUid: null, selectedEmailBody: null, selectedIndex: -1 };
            }),
            setActiveCategory: (category) => set({ activeCategory: category, selectedEmailUid: null, selectedEmailBody: null, selectedIndex: -1 }),

            // Inbox
            setUnifiedInbox: (emails) => set({ unifiedInbox: emails }),
            appendToInbox: (emails, accountId) => set((s) => {
                // Remove old emails from this account, add new ones
                const other = s.unifiedInbox.filter(e => e.accountId !== accountId);
                const tagged = emails.map(e => ({ ...e, accountId, category: categorizeEmail(e) }));
                const combined = [...other, ...tagged];
                // Sort by date descending
                combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                // Auto-collect contacts from from/to fields
                const contactSet = new Set(s.knownContacts);
                for (const e of emails) {
                    // Extract email addresses from "Name <email>" format
                    const extractEmail = (str: string) => {
                        const match = str.match(/<([^>]+)>/);
                        return match ? match[1].toLowerCase() : str.trim().toLowerCase();
                    };
                    if (e.from) contactSet.add(extractEmail(e.from));
                    if (e.to) {
                        for (const addr of e.to.split(',')) {
                            const trimmed = addr.trim();
                            if (trimmed) contactSet.add(extractEmail(trimmed));
                        }
                    }
                }

                return { unifiedInbox: combined, knownContacts: [...contactSet] };
            }),
            setSelectedEmail: (uid) => set({ selectedEmailUid: uid, selectedEmailBody: null, selectedSpamAnalysis: null }),
            setSelectedEmailBody: (body) => set({ selectedEmailBody: body }),
            setSelectedSpamAnalysis: (analysis) => set({ selectedSpamAnalysis: analysis }),
            setSelectedIndex: (index) => set({ selectedIndex: index }),
            setLoading: (loading) => set({ loading }),
            setLoadingBody: (loadingBody) => set({ loadingBody }),
            setRefreshing: (refreshing) => set({ refreshing }),
            setSearchQuery: (query) => set({ searchQuery: query }),
            setComposeOpen: (open) => set({ composeOpen: open }),
            setReplyToEmail: (email) => set({ replyToEmail: email }),
            setSetupOpen: (open) => set({ setupOpen: open }),

            // Draft queue
            addDraft: (draft) => set((s) => ({ draftQueue: [...s.draftQueue, draft] })),
            removeDraft: (id) => set((s) => ({ draftQueue: s.draftQueue.filter(d => d.id !== id) })),
            getDraftById: (id) => get().draftQueue.find(d => d.id === id),

            // Spam rules
            whitelistSender: (sender) => set((s) => ({
                whitelistedSenders: [...new Set([...s.whitelistedSenders, sender.toLowerCase()])],
                blacklistedSenders: s.blacklistedSenders.filter(b => b !== sender.toLowerCase()),
            })),
            blacklistSender: (sender) => set((s) => ({
                blacklistedSenders: [...new Set([...s.blacklistedSenders, sender.toLowerCase()])],
                whitelistedSenders: s.whitelistedSenders.filter(w => w !== sender.toLowerCase()),
            })),
            removeFromWhitelist: (sender) => set((s) => ({
                whitelistedSenders: s.whitelistedSenders.filter(w => w !== sender.toLowerCase()),
            })),
            removeFromBlacklist: (sender) => set((s) => ({
                blacklistedSenders: s.blacklistedSenders.filter(b => b !== sender.toLowerCase()),
            })),

            // Contacts autocomplete
            getContactSuggestions: (query) => {
                if (!query || query.length < 2) return [];
                const q = query.toLowerCase();
                return get().knownContacts
                    .filter(c => c.includes(q))
                    .slice(0, 8);
            },

            // Computed
            getFilteredEmails: () => {
                const s = get();
                let emails = s.unifiedInbox;

                // Filter by category
                if (s.activeCategory !== 'all') {
                    emails = emails.filter(e => (e.category || categorizeEmail(e)) === s.activeCategory);
                }

                // Filter by search
                if (s.searchQuery) {
                    const q = s.searchQuery.toLowerCase();
                    emails = emails.filter(e =>
                        e.subject.toLowerCase().includes(q) ||
                        e.from.toLowerCase().includes(q) ||
                        e.preview.toLowerCase().includes(q)
                    );
                }

                return emails;
            },
            getActiveAccount: () => {
                const s = get();
                return s.accounts.find(a => a.id === s.activeAccountId) || null;
            },
            getAccountById: (id) => get().accounts.find(a => a.id === id),
        }),
        {
            name: 'onyx-email-store',
            partialize: (state) => ({
                // Only persist non-sensitive, non-transient data
                activeFolder: state.activeFolder,
                activeCategory: state.activeCategory,
                draftQueue: state.draftQueue,
                whitelistedSenders: state.whitelistedSenders,
                blacklistedSenders: state.blacklistedSenders,
                knownContacts: state.knownContacts,
            }),
        }
    )
);
