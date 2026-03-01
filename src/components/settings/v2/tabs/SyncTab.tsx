import { useState, useEffect } from 'react';
import {
    Monitor, Wifi, WifiOff, RefreshCw, Trash2,
    Mail, Shield, Server, AlertCircle
} from 'lucide-react';
import { IS_TAURI } from '../../../../hooks/usePlatform';

// ─── P2P Settings Section ─────────────────────────────────────────────────────

function P2PSection() {
    const [enabled, setEnabled] = useState(() => {
        return localStorage.getItem('onyx-p2p-enabled') === 'true';
    });
    const isTauri = IS_TAURI;

    useEffect(() => {
        localStorage.setItem('onyx-p2p-enabled', String(enabled));
    }, [enabled]);

    const handleToggle = async () => {
        if (!isTauri) {
            setEnabled(!enabled);
            return;
        }

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            if (enabled) {
                await invoke('disable_p2p');
            } else {
                await invoke('enable_p2p');
            }
            setEnabled(!enabled);
        } catch (err) {
            console.error('[P2P] Toggle error:', err);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-bold text-zinc-100 mb-1">Device Sync (P2P)</h3>
                <p className="text-sm text-zinc-500">
                    Sync your vault with nearby devices on the same Wi-Fi network. No internet required — data is exchanged directly using end-to-end encryption.
                </p>
            </div>

            {/* Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-800/30 border border-zinc-700/20">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-700/30 text-zinc-600'}`}>
                        {enabled ? <Wifi size={20} /> : <WifiOff size={20} />}
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-zinc-200">
                            LAN Discovery
                        </div>
                        <div className="text-xs text-zinc-500">
                            {enabled ? 'Scanning for nearby Onyx devices' : 'Disabled — enable to find nearby devices'}
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleToggle}
                    className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-zinc-700'}`}
                >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${enabled ? 'left-5.5' : 'left-0.5'}`} />
                </button>
            </div>

            {/* How it works */}
            <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">How it works</div>
                <div className="grid grid-cols-1 gap-2">
                    {[
                        { icon: Monitor, text: 'Discovers devices via UDP multicast on your local network' },
                        { icon: Shield, text: 'Loro CRDT updates are exchanged over QUIC with E2EE payloads' },
                        { icon: RefreshCw, text: 'Conflict-free merge — edits on multiple devices are auto-resolved' },
                    ].map(({ icon: Icon, text }, i) => (
                        <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-zinc-800/20 border border-zinc-700/10">
                            <Icon size={14} className="text-zinc-600 mt-0.5 shrink-0" />
                            <span className="text-xs text-zinc-500">{text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Email Accounts Section ───────────────────────────────────────────────────

function EmailAccountsSection() {
    const [accounts, setAccounts] = useState<any[]>(() => {
        try {
            const saved = localStorage.getItem('onyx-email-accounts');
            if (saved) return JSON.parse(saved);
        } catch {}
        return [];
    });

    const handleRemoveAccount = (id: string) => {
        const updated = accounts.filter((a: any) => a.id !== id);
        setAccounts(updated);
        localStorage.setItem('onyx-email-accounts', JSON.stringify(updated));
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-bold text-zinc-100 mb-1">Email Accounts</h3>
                <p className="text-sm text-zinc-500">
                    Manage your connected email accounts. All email data is stored locally and encrypted with your Onyx key.
                </p>
            </div>

            {/* Privacy badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <Shield size={14} className="text-amber-400 shrink-0" />
                <span className="text-[11px] text-zinc-500">
                    100% client-side IMAP/SMTP. Your credentials and messages never leave this device.
                </span>
            </div>

            {/* Account list */}
            {accounts.length > 0 ? (
                <div className="space-y-2">
                    {accounts.map((account: any) => (
                        <div
                            key={account.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/30 border border-zinc-700/20"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-zinc-700/30 flex items-center justify-center">
                                    {account.provider === 'Gmail' ? (
                                        <span className="text-base">📧</span>
                                    ) : account.provider === 'Microsoft' ? (
                                        <span className="text-base">📬</span>
                                    ) : (
                                        <Mail size={16} className="text-zinc-400" />
                                    )}
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-zinc-200">{account.email}</div>
                                    <div className="text-xs text-zinc-600 flex items-center gap-2">
                                        <span>{account.provider || 'Custom'}</span>
                                        <span>·</span>
                                        <span className="flex items-center gap-1">
                                            <Server size={10} />
                                            {account.imapHost}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => handleRemoveAccount(account.id)}
                                className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-6 rounded-xl bg-zinc-800/20 border border-zinc-700/10">
                    <Mail size={20} className="text-zinc-700 mb-2" />
                    <span className="text-sm text-zinc-600">No email accounts connected</span>
                    <span className="text-xs text-zinc-700 mt-0.5">Add one from the Email module sidebar</span>
                </div>
            )}

            {/* Tip */}
            <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-zinc-800/20 border border-zinc-700/10">
                <AlertCircle size={14} className="text-zinc-600 mt-0.5 shrink-0" />
                <span className="text-xs text-zinc-500">
                    To add or manage accounts, navigate to the <strong className="text-zinc-400">Email</strong> module from the left sidebar and click <strong className="text-zinc-400">Add Account</strong>.
                </span>
            </div>
        </div>
    );
}

// ─── Main SyncTab ─────────────────────────────────────────────────────────────

export default function SyncTab() {
    return (
        <div className="space-y-10 max-w-2xl">
            <div>
                <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">Sync & Email</h2>
                <p className="text-sm text-zinc-500 mt-1">
                    Configure local device sync and manage connected email accounts.
                </p>
            </div>

            <P2PSection />

            <div className="h-px bg-zinc-800/40" />

            <EmailAccountsSection />
        </div>
    );
}
