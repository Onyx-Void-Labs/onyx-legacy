import { Cloud, Wifi, WifiOff, Monitor, RefreshCw } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import { useP2P, TrafficLight } from '../../contexts/P2PContext';
import { useState } from 'react';

// ─── Sync Status Indicator ───────────────────────────────────────────────────
// Shows the current sync state in a compact indicator:
//   - Cloud icon (VPS active)
//   - Traffic light dot (P2P quality: green/yellow/red)
//   - Peer count badge

export default function SyncStatusIndicator() {
    const { status: syncStatus } = useSync();
    const { enabled: p2pEnabled, connectionState, peerCount, trafficLight } = useP2P();

    const [showTooltip, setShowTooltip] = useState(false);

    // Determine status icons to show
    const isCloudConnected = syncStatus === 'connected';
    const isP2PConnected = p2pEnabled && connectionState === 'connected' && peerCount > 0;
    const isP2PScanning = p2pEnabled && connectionState === 'scanning';
    const isP2PSyncing = p2pEnabled && connectionState === 'syncing';
    const isOffline = syncStatus === 'disconnected' || syncStatus === 'offline';

    // Traffic light colour for the P2P dot
    const trafficLightColor = (tl: TrafficLight) =>
        tl === 'green' ? 'bg-emerald-400' :
        tl === 'yellow' ? 'bg-amber-400 animate-pulse' :
        'bg-red-400';

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

            {/* P2P status + traffic light dot */}
            {p2pEnabled && (
                <>
                    {isP2PConnected ? (
                        <Monitor size={13} className="text-blue-400" strokeWidth={2} />
                    ) : isP2PSyncing ? (
                        <RefreshCw size={13} className="text-blue-400 animate-spin" strokeWidth={2} />
                    ) : isP2PScanning ? (
                        <Wifi size={13} className="text-zinc-500 animate-pulse" strokeWidth={2} />
                    ) : null}
                    <span className={`w-1.5 h-1.5 rounded-full ${trafficLightColor(trafficLight)}`} />
                </>
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

                    {/* Local storage row */}
                    <div className="flex items-center gap-2 py-1.5">
                        <WifiOff size={14} className="text-zinc-600" />
                        <div className="flex-1">
                            <div className="text-xs text-zinc-300">Local Storage</div>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </div>
                </div>
            )}
        </div>
    );
}
