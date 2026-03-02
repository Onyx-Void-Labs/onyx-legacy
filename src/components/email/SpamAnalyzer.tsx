/**
 * SpamAnalyzer.tsx — Per-email spam score breakdown with progress bars,
 * reason tooltips, SPF/DKIM/DMARC badges, and train buttons.
 */

import { Shield, ShieldCheck, ShieldX, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useEmailStore, type SpamAnalysis } from '../../store/emailStore';

/* ─── Helpers ────────────────────────────────────────────────── */

function getScoreColor(score: number): string {
    if (score < 3) return 'text-emerald-400';
    if (score < 7) return 'text-amber-400';
    return 'text-red-400';
}

function getBarColor(score: number): string {
    if (score < 3) return 'bg-emerald-400';
    if (score < 7) return 'bg-amber-400';
    return 'bg-red-400';
}

function getBarBg(score: number): string {
    if (score < 3) return 'bg-emerald-500/10';
    if (score < 7) return 'bg-amber-500/10';
    return 'bg-red-500/10';
}

function getScoreLabel(score: number): string {
    if (score < 3) return 'Clean';
    if (score < 5) return 'Low Risk';
    if (score < 8) return 'Suspicious';
    if (score < 12) return 'Likely Spam';
    return 'Spam';
}

function getScorePercent(score: number): number {
    return Math.min(100, Math.max(0, (score / 15) * 100));
}

/* ─── Component ──────────────────────────────────────────────── */

interface SpamAnalyzerProps {
    analysis: SpamAnalysis;
    senderEmail?: string;
}

export default function SpamAnalyzer({ analysis, senderEmail }: SpamAnalyzerProps) {
    const { whitelistSender, blacklistSender, whitelistedSenders, blacklistedSenders } = useEmailStore();

    const isWhitelisted = senderEmail ? whitelistedSenders.includes(senderEmail.toLowerCase()) : false;
    const isBlacklisted = senderEmail ? blacklistedSenders.includes(senderEmail.toLowerCase()) : false;

    return (
        <div className="px-5 py-3 space-y-3">
            {/* Score header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Shield size={14} className={getScoreColor(analysis.score)} />
                    <span className="text-xs font-semibold text-zinc-300">Spam Analysis</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold tabular-nums ${getScoreColor(analysis.score)}`}>
                        {analysis.score.toFixed(1)}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        analysis.score < 3 ? 'bg-emerald-500/10 text-emerald-400' :
                        analysis.score < 7 ? 'bg-amber-500/10 text-amber-400' :
                        'bg-red-500/10 text-red-400'
                    }`}>
                        {getScoreLabel(analysis.score)}
                    </span>
                </div>
            </div>

            {/* Score bar */}
            <div className={`w-full h-2 rounded-full ${getBarBg(analysis.score)}`}>
                <div
                    className={`h-full rounded-full transition-all duration-500 ${getBarColor(analysis.score)}`}
                    style={{ width: `${getScorePercent(analysis.score)}%` }}
                />
            </div>

            {/* Auth badges */}
            <div className="flex items-center gap-3">
                <AuthBadge label="SPF" pass={analysis.spf_pass} />
                <AuthBadge label="DKIM" pass={analysis.dkim_pass} />
                <AuthBadge label="DMARC" pass={analysis.dmarc_pass} />
            </div>

            {/* Reasons */}
            {analysis.reasons.length > 0 && (
                <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                        Reasons
                    </div>
                    {analysis.reasons.slice(0, 8).map((reason, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between px-2 py-1 rounded bg-zinc-800/30"
                            title={reason.description}
                        >
                            <span className="text-[11px] text-zinc-400 font-mono">{reason.name}</span>
                            <span className={`text-[11px] font-bold tabular-nums ${
                                reason.score > 0 ? 'text-red-400' : 'text-emerald-400'
                            }`}>
                                {reason.score > 0 ? '+' : ''}{reason.score.toFixed(1)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Actions */}
            {senderEmail && (
                <div className="flex items-center gap-2 pt-1">
                    <button
                        onClick={() => whitelistSender(senderEmail)}
                        disabled={isWhitelisted}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                            isWhitelisted
                                ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                                : 'bg-zinc-800/30 text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-400'
                        }`}
                    >
                        <ThumbsUp size={12} />
                        {isWhitelisted ? 'Whitelisted' : 'Not Spam'}
                    </button>
                    <button
                        onClick={() => blacklistSender(senderEmail)}
                        disabled={isBlacklisted}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                            isBlacklisted
                                ? 'bg-red-500/20 text-red-400 cursor-default'
                                : 'bg-zinc-800/30 text-zinc-400 hover:bg-red-500/10 hover:text-red-400'
                        }`}
                    >
                        <ThumbsDown size={12} />
                        {isBlacklisted ? 'Blacklisted' : 'Spam'}
                    </button>
                </div>
            )}

            {/* Unsubscribe */}
            {analysis.has_unsubscribe && analysis.list_unsubscribe && (
                <div className="text-[10px] text-zinc-600 bg-zinc-800/20 rounded px-2 py-1.5">
                    📧 List-Unsubscribe header detected
                </div>
            )}
        </div>
    );
}

function AuthBadge({ label, pass }: { label: string; pass: boolean }) {
    return (
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${
            pass
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
        }`}>
            {pass ? <ShieldCheck size={10} /> : <ShieldX size={10} />}
            {label}
        </div>
    );
}
