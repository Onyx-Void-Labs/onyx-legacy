/**
 * messagingStore.ts — Zustand store for the decentralized E2EE messaging system.
 * Manages servers, channels, messages, DMs, and the local cryptographic identity.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessagingIdentity {
    public_key: string;
    display_name: string;
    avatar_emoji: string;
    created_at: number;
}

export interface Server {
    id: string;
    name: string;
    icon_emoji: string;
    owner_pubkey: string;
    group_key: string;
    invite_code: string | null;
    created_at: number;
}

export interface Channel {
    id: string;
    server_id: string;
    name: string;
    channel_type: 'text' | 'voice' | 'announcement';
    description: string;
    position: number;
    created_at: number;
}

export interface Message {
    id: string;
    channel_id: string;
    server_id: string;
    sender_pubkey: string;
    sender_name: string;
    content: string;
    message_type: 'text' | 'image' | 'file' | 'system' | 'reply';
    reply_to: string | null;
    edited_at: number | null;
    created_at: number;
    encrypted_blob: string | null;
}

export interface DirectMessage {
    id: string;
    sender_pubkey: string;
    recipient_pubkey: string;
    sender_name: string;
    content: string;
    encrypted_blob: string | null;
    is_read: boolean;
    created_at: number;
}

export interface DmConversation {
    peer_pubkey: string;
    peer_name: string;
    last_message: string;
    last_message_at: number;
    unread_count: number;
}

export type MessagingView = 'servers' | 'dms';

// ─── Store ────────────────────────────────────────────────────────────────────

interface MessagingState {
    // Identity
    identity: MessagingIdentity | null;
    identityLoading: boolean;

    // View state
    view: MessagingView;
    activeServerId: string | null;
    activeChannelId: string | null;
    activeDmPubkey: string | null;

    // Data
    servers: Server[];
    channels: Record<string, Channel[]>; // serverId -> channels
    messages: Record<string, Message[]>; // channelId -> messages
    dmConversations: DmConversation[];
    dmMessages: Record<string, DirectMessage[]>; // peerPubkey -> messages

    // UI state
    showCreateServer: boolean;
    showServerSettings: boolean;
    showInviteModal: boolean;
    messageInput: string;
    searchQuery: string;
    membersVisible: boolean;

    // Loading states
    loadingServers: boolean;
    loadingMessages: boolean;
    sendingMessage: boolean;

    // Actions — Identity
    initIdentity: (displayName?: string) => Promise<void>;

    // Actions — Navigation
    setView: (view: MessagingView) => void;
    setActiveServer: (serverId: string | null) => void;
    setActiveChannel: (channelId: string | null) => void;
    setActiveDm: (pubkey: string | null) => void;

    // Actions — Servers
    loadServers: () => Promise<void>;
    createServer: (name: string, emoji: string) => Promise<Server>;
    joinServer: (serverId: string, name: string, emoji: string, groupKey: string) => Promise<void>;

    // Actions — Channels
    loadChannels: (serverId: string) => Promise<void>;
    createChannel: (serverId: string, name: string, type: string, description: string) => Promise<Channel>;

    // Actions — Messages
    loadMessages: (channelId: string) => Promise<void>;
    sendMessage: (content: string, replyTo?: string) => Promise<void>;

    // Actions — DMs
    loadDmConversations: () => Promise<void>;
    loadDmMessages: (peerPubkey: string) => Promise<void>;
    sendDm: (peerPubkey: string, content: string) => Promise<void>;

    // Actions — UI
    setShowCreateServer: (show: boolean) => void;
    setShowServerSettings: (show: boolean) => void;
    setShowInviteModal: (show: boolean) => void;
    setMessageInput: (input: string) => void;
    setSearchQuery: (query: string) => void;
    setMembersVisible: (visible: boolean) => void;
}

export const useMessagingStore = create<MessagingState>()(
    persist(
        (set, get) => ({
            // Initial state
            identity: null,
            identityLoading: false,
            view: 'servers',
            activeServerId: null,
            activeChannelId: null,
            activeDmPubkey: null,
            servers: [],
            channels: {},
            messages: {},
            dmConversations: [],
            dmMessages: {},
            showCreateServer: false,
            showServerSettings: false,
            showInviteModal: false,
            messageInput: '',
            searchQuery: '',
            membersVisible: false,
            loadingServers: false,
            loadingMessages: false,
            sendingMessage: false,

            // ─── Identity ─────────────────────────────────────────────────────
            initIdentity: async (displayName = 'Anon') => {
                set({ identityLoading: true });
                try {
                    const identity: MessagingIdentity = await invoke('generate_messaging_keypair', {
                        displayName,
                    });
                    set({ identity, identityLoading: false });
                } catch (e) {
                    console.error('[Messaging] Init identity failed:', e);
                    set({ identityLoading: false });
                }
            },

            // ─── Navigation ───────────────────────────────────────────────────
            setView: (view) => set({ view, activeDmPubkey: null }),
            setActiveServer: (serverId) => {
                set({ activeServerId: serverId, activeChannelId: null });
                if (serverId) {
                    get().loadChannels(serverId);
                }
            },
            setActiveChannel: (channelId) => {
                set({ activeChannelId: channelId, messageInput: '' });
                if (channelId) {
                    get().loadMessages(channelId);
                }
            },
            setActiveDm: (pubkey) => {
                set({ activeDmPubkey: pubkey, view: 'dms', messageInput: '' });
                if (pubkey) {
                    get().loadDmMessages(pubkey);
                }
            },

            // ─── Servers ──────────────────────────────────────────────────────
            loadServers: async () => {
                set({ loadingServers: true });
                try {
                    const servers: Server[] = await invoke('get_servers');
                    set({ servers, loadingServers: false });
                } catch (e) {
                    console.error('[Messaging] Load servers failed:', e);
                    set({ loadingServers: false });
                }
            },

            createServer: async (name, emoji) => {
                const server: Server = await invoke('create_server', {
                    name,
                    iconEmoji: emoji,
                });
                set(s => ({ servers: [...s.servers, server], showCreateServer: false }));
                get().setActiveServer(server.id);
                return server;
            },

            joinServer: async (serverId, name, emoji, groupKey) => {
                await invoke('join_server', {
                    serverId,
                    name,
                    iconEmoji: emoji,
                    groupKey,
                });
                await get().loadServers();
            },

            // ─── Channels ─────────────────────────────────────────────────────
            loadChannels: async (serverId) => {
                try {
                    const channels: Channel[] = await invoke('get_channels', { serverId });
                    set(s => ({
                        channels: { ...s.channels, [serverId]: channels },
                        activeChannelId: s.activeChannelId || channels.find(c => c.channel_type === 'text')?.id || null,
                    }));
                    // Auto-load messages for first text channel
                    const firstText = channels.find(c => c.channel_type === 'text');
                    if (firstText && !get().activeChannelId) {
                        get().loadMessages(firstText.id);
                    }
                } catch (e) {
                    console.error('[Messaging] Load channels failed:', e);
                }
            },

            createChannel: async (serverId, name, type, description) => {
                const channel: Channel = await invoke('create_channel', {
                    serverId,
                    name,
                    channelType: type,
                    description,
                });
                set(s => ({
                    channels: {
                        ...s.channels,
                        [serverId]: [...(s.channels[serverId] || []), channel],
                    },
                }));
                return channel;
            },

            // ─── Messages ─────────────────────────────────────────────────────
            loadMessages: async (channelId) => {
                set({ loadingMessages: true });
                try {
                    const messages: Message[] = await invoke('get_messages', {
                        channelId,
                        before: null,
                        limit: 50,
                    });
                    set(s => ({
                        messages: { ...s.messages, [channelId]: messages },
                        loadingMessages: false,
                    }));
                } catch (e) {
                    console.error('[Messaging] Load messages failed:', e);
                    set({ loadingMessages: false });
                }
            },

            sendMessage: async (content, replyTo) => {
                const { activeServerId, activeChannelId } = get();
                if (!activeServerId || !activeChannelId || !content.trim()) return;

                set({ sendingMessage: true });
                try {
                    const msg: Message = await invoke('send_message', {
                        serverId: activeServerId,
                        channelId: activeChannelId,
                        content: content.trim(),
                        replyTo: replyTo || null,
                    });

                    set(s => ({
                        messages: {
                            ...s.messages,
                            [activeChannelId]: [...(s.messages[activeChannelId] || []), msg],
                        },
                        messageInput: '',
                        sendingMessage: false,
                    }));
                } catch (e) {
                    console.error('[Messaging] Send message failed:', e);
                    set({ sendingMessage: false });
                }
            },

            // ─── DMs ─────────────────────────────────────────────────────────
            loadDmConversations: async () => {
                try {
                    const conversations: DmConversation[] = await invoke('get_dm_conversations');
                    set({ dmConversations: conversations });
                } catch (e) {
                    console.error('[Messaging] Load DM conversations failed:', e);
                }
            },

            loadDmMessages: async (peerPubkey) => {
                set({ loadingMessages: true });
                try {
                    const messages: DirectMessage[] = await invoke('get_dm_messages', {
                        peerPubkey,
                        limit: 100,
                    });
                    set(s => ({
                        dmMessages: { ...s.dmMessages, [peerPubkey]: messages },
                        loadingMessages: false,
                    }));
                } catch (e) {
                    console.error('[Messaging] Load DM messages failed:', e);
                    set({ loadingMessages: false });
                }
            },

            sendDm: async (peerPubkey, content) => {
                if (!content.trim()) return;
                set({ sendingMessage: true });
                try {
                    const dm: DirectMessage = await invoke('send_dm', {
                        recipientPubkey: peerPubkey,
                        content: content.trim(),
                    });
                    set(s => ({
                        dmMessages: {
                            ...s.dmMessages,
                            [peerPubkey]: [...(s.dmMessages[peerPubkey] || []), dm],
                        },
                        messageInput: '',
                        sendingMessage: false,
                    }));
                } catch (e) {
                    console.error('[Messaging] Send DM failed:', e);
                    set({ sendingMessage: false });
                }
            },

            // ─── UI ──────────────────────────────────────────────────────────
            setShowCreateServer: (show) => set({ showCreateServer: show }),
            setShowServerSettings: (show) => set({ showServerSettings: show }),
            setShowInviteModal: (show) => set({ showInviteModal: show }),
            setMessageInput: (input) => set({ messageInput: input }),
            setSearchQuery: (query) => set({ searchQuery: query }),
            setMembersVisible: (visible) => set({ membersVisible: visible }),
        }),
        {
            name: 'onyx-messaging-store',
            partialize: (state) => ({
                view: state.view,
                activeServerId: state.activeServerId,
            }),
        }
    )
);
