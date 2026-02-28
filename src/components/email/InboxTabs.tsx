/**
 * InboxTabs.tsx — Compact category grid for the email inbox.
 * 4 squares layout: Personal / Newsletters / Transactions / Spam
 * Plus an "All" toggle at the top.
 */

import { type EmailCategory } from '../../store/emailStore';

const GRID_TABS: { id: EmailCategory; label: string; icon: string; color: string; bg: string }[] = [
    { id: 'personal', label: 'Personal', icon: '👤', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
    { id: 'newsletters', label: 'News', icon: '📰', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
    { id: 'transactional', label: 'Finance', icon: '💳', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
    { id: 'spam', label: 'Spam', icon: '🛡️', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
];

interface InboxTabsProps {
    active: EmailCategory;
    onChange: (category: EmailCategory) => void;
    counts?: Record<EmailCategory, number>;
}

export default function InboxTabs({ active, onChange, counts }: InboxTabsProps) {
    return (
        <div className="px-2.5 pt-2.5 pb-1.5 border-b border-zinc-800/30 shrink-0 space-y-1.5">
            {/* All toggle */}
            <button
                onClick={() => onChange(active === 'all' ? 'personal' : 'all')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    active === 'all'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 border border-transparent'
                }`}
            >
                <span>📥 All Mail</span>
                {counts?.all !== undefined && counts.all > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-400">
                        {counts.all > 999 ? '999+' : counts.all}
                    </span>
                )}
            </button>

            {/* 2×2 grid */}
            <div className="grid grid-cols-2 gap-1">
                {GRID_TABS.map((tab) => {
                    const isActive = active === tab.id;
                    const count = counts?.[tab.id] || 0;

                    return (
                        <button
                            key={tab.id}
                            onClick={() => onChange(tab.id)}
                            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg text-[10px] font-medium transition-all border ${
                                isActive
                                    ? `${tab.bg} ${tab.color}`
                                    : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/20 border-transparent'
                            }`}
                        >
                            <span className="text-sm leading-none">{tab.icon}</span>
                            <span className="truncate w-full text-center">{tab.label}</span>
                            {count > 0 && (
                                <span className={`absolute top-1 right-1 text-[8px] px-1 py-px rounded-full font-bold ${
                                    isActive ? 'bg-white/10' : 'bg-zinc-800 text-zinc-500'
                                }`}>
                                    {count > 99 ? '99+' : count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
