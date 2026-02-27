import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerInfo {
    id: string;
    name: string;
    ip: string;
    port: number;
    last_seen: number;
}

export interface P2PStatus {
    enabled: boolean;
    listening: boolean;
    port: number;
    peer_count: number;
    peers: PeerInfo[];
    last_sync: number | null;
}

export type P2PConnectionState = 'disabled' | 'scanning' | 'connected' | 'syncing' | 'error';

interface P2PContextType {
    /** Whether P2P is enabled in settings */
    enabled: boolean;
    /** Toggle P2P on/off */
    setEnabled: (enabled: boolean) => void;
    /** Current connection state */
    connectionState: P2PConnectionState;
    /** Discovered LAN peers */
    peers: PeerInfo[];
    /** Number of active peers */
    peerCount: number;
    /** Last successful sync timestamp */
    lastSync: number | null;
    /** Manually trigger sync with a specific peer */
    syncWithPeer: (peerId: string, encryptedPayload: string, room: string) => Promise<void>;
    /** Flush all pending ops to all peers (called on app close) */
    flushOps: (encryptedPayload: string, room: string) => Promise<number>;
    /** Refresh peer list */
    refreshPeers: () => Promise<void>;
    /** Full status object */
    status: P2PStatus | null;
}

const P2PContext = createContext<P2PContextType | null>(null);

export function useP2P() {
    const context = useContext(P2PContext);
    if (!context) throw new Error('useP2P must be used within P2PProvider');
    return context;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const P2P_SETTINGS_KEY = 'onyx-p2p-enabled';

export const P2PProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [enabled, setEnabledState] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem(P2P_SETTINGS_KEY);
            return saved === 'true';
        } catch {
            return false;
        }
    });

    const [connectionState, setConnectionState] = useState<P2PConnectionState>('disabled');
    const [peers, setPeers] = useState<PeerInfo[]>([]);
    const [lastSync, setLastSync] = useState<number | null>(null);
    const [status, setStatus] = useState<P2PStatus | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

    // ─── Enable/Disable P2P ───────────────────────────────────────────────

    const setEnabled = useCallback(async (value: boolean) => {
        setEnabledState(value);
        localStorage.setItem(P2P_SETTINGS_KEY, value.toString());

        if (!isTauri) return;

        try {
            if (value) {
                await invoke('enable_p2p');
                setConnectionState('scanning');
            } else {
                await invoke('disable_p2p');
                setConnectionState('disabled');
                setPeers([]);
                setStatus(null);
            }
        } catch (err) {
            console.error('[P2P] Toggle error:', err);
            setConnectionState('error');
        }
    }, [isTauri]);

    // ─── Poll for peers and status ────────────────────────────────────────

    const refreshPeers = useCallback(async () => {
        if (!isTauri || !enabled) return;

        try {
            const result = await invoke<P2PStatus>('get_p2p_status');
            setStatus(result);
            setPeers(result.peers);
            setLastSync(result.last_sync);

            if (result.peer_count > 0) {
                setConnectionState('connected');
            } else if (result.enabled) {
                setConnectionState('scanning');
            }
        } catch (err) {
            console.error('[P2P] Status poll error:', err);
        }
    }, [isTauri, enabled]);

    // Start/stop polling when enabled state changes
    useEffect(() => {
        if (enabled && isTauri) {
            // Initial enable
            invoke('enable_p2p').catch(console.error);
            setConnectionState('scanning');

            // Poll every 5 seconds
            pollRef.current = setInterval(refreshPeers, 5000);
            refreshPeers();
        } else {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        }

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [enabled, isTauri, refreshPeers]);

    // ─── Sync with peer ───────────────────────────────────────────────────

    const syncWithPeer = useCallback(async (peerId: string, encryptedPayload: string, room: string) => {
        if (!isTauri) return;

        setConnectionState('syncing');
        try {
            await invoke('sync_with_peer', {
                peerId,
                encryptedPayload,
                room,
            });
            setLastSync(Math.floor(Date.now() / 1000));
            setConnectionState('connected');
        } catch (err) {
            console.error('[P2P] Sync error:', err);
            setConnectionState('error');
            // Recover to connected state after 3s
            setTimeout(() => {
                setConnectionState(peers.length > 0 ? 'connected' : 'scanning');
            }, 3000);
            throw err;
        }
    }, [isTauri, peers.length]);

    // ─── Flush ops on close ───────────────────────────────────────────────

    const flushOps = useCallback(async (encryptedPayload: string, room: string): Promise<number> => {
        if (!isTauri || !enabled) return 0;

        try {
            const count = await invoke<number>('flush_p2p_ops', {
                encryptedPayload,
                room,
            });
            return count;
        } catch (err) {
            console.error('[P2P] Flush error:', err);
            return 0;
        }
    }, [isTauri, enabled]);

    // ─── Listen for incoming P2P sync messages from Rust ──────────────────

    useEffect(() => {
        if (!isTauri) return;

        let unlisten: (() => void) | null = null;

        listen<{ payload: string; room: string; sender_id: string }>('p2p-sync-received', (event) => {
            console.log('[P2P] Received sync from peer:', event.payload.sender_id);
            // Dispatch custom DOM event for SyncContext to handle
            window.dispatchEvent(new CustomEvent('onyx:p2p-sync', {
                detail: {
                    payload: event.payload.payload,
                    room: event.payload.room,
                    senderId: event.payload.sender_id,
                }
            }));
            setLastSync(Math.floor(Date.now() / 1000));
        }).then(fn => { unlisten = fn; });

        return () => {
            if (unlisten) unlisten();
        };
    }, [isTauri]);

    // ─── Cleanup on unmount ───────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (isTauri && enabled) {
                invoke('disable_p2p').catch(() => {});
            }
        };
    }, []);

    return (
        <P2PContext.Provider value={{
            enabled,
            setEnabled,
            connectionState,
            peers,
            peerCount: peers.length,
            lastSync,
            syncWithPeer,
            flushOps,
            refreshPeers,
            status,
        }}>
            {children}
        </P2PContext.Provider>
    );
};
