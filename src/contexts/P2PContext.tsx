import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IS_TAURI, IS_ANDROID, IS_IOS } from '../hooks/usePlatform';

// ─── Types (aligned with Iroh peer info from network.rs) ─────────────────────

export interface PeerInfo {
    node_id: string;
    conn_type: string;      // "direct" | "relay" | "direct+relay" | "none"
    latency_ms: number | null;
    is_connected: boolean;
    relay_url: string | null;
    last_activity: number;
}

export interface IrohNodeStatus {
    active: boolean;
    node_id: string;
    peer_count: number;
    peers: PeerInfo[];
    relay_url: string | null;
    active_connections: number;
    mdns_active: boolean;
    dht_active: boolean;
}

/**
 * Traffic Light color for the P2P connection indicator:
 *   green  = at least one direct P2P peer
 *   yellow = connected via relay only
 *   red    = no peers / node offline
 */
export type TrafficLight = 'green' | 'yellow' | 'red';

export type P2PConnectionState = 'disabled' | 'scanning' | 'connected' | 'syncing' | 'error';

interface P2PContextType {
    /** Whether the Iroh node is active */
    enabled: boolean;
    /** Current connection state */
    connectionState: P2PConnectionState;
    /** Discovered/connected peers */
    peers: PeerInfo[];
    /** Number of active peers */
    peerCount: number;
    /** Traffic light indicator */
    trafficLight: TrafficLight;
    /** Our NodeId (hex) */
    nodeId: string | null;
    /** Full Iroh status object */
    status: IrohNodeStatus | null;
    /** Refresh peer list */
    refreshPeers: () => Promise<void>;
    /** Sync a specific doc with a peer */
    syncDocWithPeer: (peerId: string, docId: string) => Promise<void>;
}

const P2PContext = createContext<P2PContextType | null>(null);

export function useP2P() {
    const context = useContext(P2PContext);
    if (!context) throw new Error('useP2P must be used within P2PProvider');
    return context;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const P2PProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [connectionState, setConnectionState] = useState<P2PConnectionState>('disabled');
    const [peers, setPeers] = useState<PeerInfo[]>([]);
    const [nodeId, setNodeId] = useState<string | null>(null);
    const [status, setStatus] = useState<IrohNodeStatus | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isTauri = IS_TAURI;
    const isSupported = isTauri && !IS_ANDROID && !IS_IOS;

    // ─── Compute traffic light from peers ─────────────────────────────────

    const trafficLight: TrafficLight = (() => {
        if (!status?.active || peers.length === 0) return 'red';
        const hasDirect = peers.some(p => p.conn_type === 'direct' || p.conn_type === 'direct+relay');
        return hasDirect ? 'green' : 'yellow';
    })();

    const enabled = status?.active ?? false;

    // ─── Poll for Iroh status ─────────────────────────────────────────────

    const refreshPeers = useCallback(async () => {
        if (!isSupported) return;

        try {
            const result = await invoke<IrohNodeStatus>('iroh_get_status');
            setStatus(result);
            setPeers(result.peers);
            setNodeId(result.node_id);

            if (result.active_connections > 0) {
                setConnectionState('connected');
            } else if (result.active) {
                setConnectionState('scanning');
            } else {
                setConnectionState('disabled');
            }
        } catch (err) {
            console.error('[P2P] Iroh status poll error:', err);
        }
    }, [isSupported]);

    // Start polling on mount
    useEffect(() => {
        if (!isSupported) return;

        // Initial fetch
        refreshPeers();

        // Poll every 5 seconds
        pollRef.current = setInterval(refreshPeers, 5000);

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [isSupported, refreshPeers]);

    // ─── Sync a doc with a specific peer via Iroh ─────────────────────────

    const syncDocWithPeer = useCallback(async (peerId: string, docId: string) => {
        if (!isSupported) return;

        setConnectionState('syncing');
        try {
            await invoke('sync_doc_with_peer', { peerNodeId: peerId, docId });
            setConnectionState('connected');
        } catch (err) {
            console.error('[P2P] Doc sync error:', err);
            setConnectionState('error');
            setTimeout(() => {
                setConnectionState(peers.length > 0 ? 'connected' : 'scanning');
            }, 3000);
            throw err;
        }
    }, [isSupported, peers.length]);

    return (
        <P2PContext.Provider value={{
            enabled,
            connectionState,
            peers,
            peerCount: peers.length,
            trafficLight,
            nodeId,
            status,
            refreshPeers,
            syncDocWithPeer,
        }}>
            {children}
        </P2PContext.Provider>
    );
};
