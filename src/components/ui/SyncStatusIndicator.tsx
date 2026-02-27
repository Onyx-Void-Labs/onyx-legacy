import { Cloud, Wifi, WifiOff, Monitor, RefreshCw } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import { useP2P } from '../../contexts/P2PContext';
import { useState, useEffect } from 'react';

// ─── Sync Status Indicator ───────────────────────────────────────────────────
// Shows the current sync state in a compact indicator:
//   - Cloud icon (VPS active)
//   - Peer icon (P2P active)
//   - Offline icon (IndexedDB only)

export default function SyncStatusIndicator() {
    const { status: syncStatus } = useSync();
    const { enabled: p2pEnabled, connectionState, peerCount, lastSync } = useP2P();

    const [showTooltip, setShowTooltip] = useState(false);

    // Determine status icons to show
    const isCloudConnected = syncStatus === 'connected';
    const isP2PConnected = p2pEnabled && connectionState === 'connected' && peerCount > 0;
    const isP2PScanning = p2pEnabled && connectionState === 'scanning';
    const isP2PSyncing = p2pEnabled && connectionState === 'syncing';
    const isOffline = syncStatus === 'disconnected' || syncStatus === 'offline';

    // Format last sync time
    const formatLastSync = (ts: number | null): string => {
        if (!ts) return 'Never';
        const diff = Math.floor(Date.now() / 1000) - ts;
        if (diff < 10) return 'Just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    // Auto-update the "ago" text
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!lastSync) return;
        const interval = setInterval(() => setTick(t => t + 1), 10000);
        return () => clearInterval(interval);
    }, [lastSync]);

    return (
        <div
            className="relative flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-800/50 transition-colors cursor-default"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {/* Cloud status */}
            {isCloudConnected && (
                <Cloud
                    size={13}
                    className="text-emerald-400"
                    strokeWidth={2}
                />
            )}
            {syncStatus === 'connecting' && (
                <Cloud
                    size={13}
                    className="text-amber-400 animate-pulse"
                    strokeWidth={2}
                />
            )}
            {isOffline && !p2pEnabled && (
                <WifiOff
                    size={13}
                    className="text-zinc-500"
                    strokeWidth={2}
                />
            )}

            {/* P2P status */}
            {isP2PConnected && (
                <Monitor
                    size={13}
                    className="text-blue-400"
                    strokeWidth={2}
                />
            )}
            {isP2PScanning && (
                <Wifi
                    size={13}
                    className="text-zinc-500 animate-pulse"
                    strokeWidth={2}
                />
            )}
            {isP2PSyncing && (
                <RefreshCw
                    size={13}
                    className="text-blue-400 animate-spin"
                    strokeWidth={2}
                />
            )}

            {/* Peer count badge */}
            {isP2PConnected && peerCount > 0 && (
                <span className="text-[9px] font-bold text-blue-400 bg-blue-400/10 px-1 py-0.5 rounded-full min-w-3.5 text-center leading-none">
                    {peerCount}
                </span>
            )}

            {/* Tooltip */}
            {showTooltip && (
                <div
                    className="absolute top-full right-0 mt-1.5 w-52 bg-zinc-900 border border-zinc-800/80 rounded-xl shadow-2xl shadow-black/50 p-3 z-9999"
                    style={{ animation: 'fadeIn 0.1s ease-out' }}
                >
                    <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Sync Status
                    </div>

                    {/* Cloud row */}
                    <div className="flex items-center gap-2 py-1.5">
                        <Cloud size={14} className={isCloudConnected ? 'text-emerald-400' : 'text-zinc-600'} />
                        <div className="flex-1">
                            <div className="text-xs text-zinc-300">VPS Cloud</div>
                        </div>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            isCloudConnected ? 'bg-emerald-400' :
                            syncStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
                            'bg-zinc-600'
                        }`} />
                    </div>

                    {/* P2P row */}
                    <div className="flex items-center gap-2 py-1.5">
                        <Monitor size={14} className={isP2PConnected ? 'text-blue-400' : 'text-zinc-600'} />
                        <div className="flex-1">
                            <div className="text-xs text-zinc-300">Local P2P</div>
                            {p2pEnabled && (
                                <div className="text-[10px] text-zinc-600">
                                    {peerCount} peer{peerCount !== 1 ? 's' : ''} nearby
                                </div>
                            )}
                        </div>
                        {p2pEnabled ? (
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                isP2PConnected ? 'bg-blue-400' :
                                isP2PScanning ? 'bg-amber-400 animate-pulse' :
                                'bg-zinc-600'
                            }`} />
                        ) : (
                            <span className="text-[9px] text-zinc-600">OFF</span>
                        )}
                    </div>

                    {/* Offline row */}
                    <div className="flex items-center gap-2 py-1.5">
                        <WifiOff size={14} className="text-zinc-600" />
                        <div className="flex-1">
                            <div className="text-xs text-zinc-300">IndexedDB</div>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </div>

                    {/* Last P2P sync */}
                    {p2pEnabled && lastSync && (
                        <div className="mt-2 pt-2 border-t border-zinc-800/50">
                            <div className="text-[10px] text-zinc-600">
                                Last P2P sync: {formatLastSync(lastSync)}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
