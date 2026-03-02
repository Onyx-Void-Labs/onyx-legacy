import { useState, useEffect, useRef } from 'react';
import {
    Hash, Volume2, Plus, Search, ChevronDown, ChevronRight, Smile,
    Paperclip, Send, Shield, Settings, Users, Bell, Pin, Copy,
    Reply, AtSign, Lock,
    MessageSquare, Mic, Headphones,
} from 'lucide-react';
import {
    useMessagingStore,
    type Message,
    type DirectMessage,
    type DmConversation,
    type Channel,
} from '../../store/messagingStore';

// ─── Messaging View (Full Discord-like layout) ──────────────────────────────

interface MessagesViewProps {
    sidebarCollapsed?: boolean;
}

export default function MessagesView({ sidebarCollapsed = false }: MessagesViewProps) {
    const store = useMessagingStore();
    const {
        identity, identityLoading,
        view, servers, channels, messages,
        activeServerId, activeChannelId, activeDmPubkey,
        dmConversations, dmMessages,
        messageInput, loadingMessages, sendingMessage,
        showCreateServer,
    } = store;

    // Initialize identity on mount
    useEffect(() => {
        if (!identity && !identityLoading) {
            store.initIdentity();
        }
        store.loadServers();
        store.loadDmConversations();
    }, []);

    // ─── Identity Setup Screen ────────────────────────────────────────────────
    if (!identity) {
        return <IdentitySetup />;
    }

    const activeServer = servers.find(s => s.id === activeServerId);
    const serverChannels = activeServerId ? channels[activeServerId] || [] : [];
    const textChannels = serverChannels.filter(c => c.channel_type === 'text');
    const voiceChannels = serverChannels.filter(c => c.channel_type === 'voice');
    const activeChannel = serverChannels.find(c => c.id === activeChannelId);
    const channelMessages = activeChannelId ? messages[activeChannelId] || [] : [];
    const activeDmMessages = activeDmPubkey ? dmMessages[activeDmPubkey] || [] : [];

    return (
        <div className="flex h-full overflow-hidden">
            {/* ─── Server Rail ──────────────────────────────────────────────── */}
            <div className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? 'w-0 opacity-0 border-none px-0' : 'w-18 opacity-100 border-r border-zinc-800/30'}`}>
                <div className="w-18 h-full bg-zinc-950 flex flex-col items-center py-3 gap-2 overflow-y-auto scrollbar-none">
                    {/* Home / DMs */}
                    <ServerButton
                        emoji="💬"
                        isActive={view === 'dms'}
                        isHome
                        onClick={() => { store.setView('dms'); store.setActiveServer(null); }}
                        tooltip="Direct Messages"
                    />

                    <div className="w-8 border-t border-zinc-800/50 my-1" />

                    {/* Server list */}
                    {servers.map(server => (
                        <ServerButton
                            key={server.id}
                            emoji={server.icon_emoji}
                            isActive={activeServerId === server.id}
                            onClick={() => { store.setView('servers'); store.setActiveServer(server.id); }}
                            tooltip={server.name}
                            unread={false}
                        />
                    ))}

                    {/* Add Server */}
                    <button
                        onClick={() => store.setShowCreateServer(true)}
                        className="w-12 h-12 rounded-3xl bg-zinc-800/40 text-emerald-400 flex items-center justify-center hover:rounded-xl hover:bg-emerald-500/20 transition-all duration-200"
                        title="Create Server"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            </div>

            {/* ─── Channel Sidebar / DM List ───────────────────────────────── */}
            <div className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? 'w-0 opacity-0 border-none' : 'w-60 opacity-100 border-r border-zinc-800/30'}`}>
                <div className="w-60 h-full flex flex-col bg-zinc-900/60">
                    {view === 'servers' && activeServer ? (
                        <ServerChannelList
                            server={activeServer}
                            textChannels={textChannels}
                            voiceChannels={voiceChannels}
                            activeChannelId={activeChannelId}
                            onSelectChannel={(id) => store.setActiveChannel(id)}
                            onCreateChannel={() => {
                                const name = prompt('Channel name:');
                                if (name) store.createChannel(activeServer.id, name, 'text', '');
                            }}
                            onSettings={() => store.setShowServerSettings(true)}
                        />
                    ) : (
                        <DmList
                            conversations={dmConversations}
                            activePubkey={activeDmPubkey}
                            onSelect={(pubkey) => store.setActiveDm(pubkey)}
                        />
                    )}

                    {/* User footer */}
                    <UserFooter identity={identity} />
                </div>
            </div>

            {/* ─── Main Chat Area ──────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col bg-zinc-950/50 min-w-0">
                {view === 'servers' && activeChannel ? (
                    <>
                        <ChannelHeader channel={activeChannel} />
                        <MessageList
                            messages={channelMessages}
                            loading={loadingMessages}
                            myPubkey={identity.public_key}
                        />
                        <MessageComposer
                            placeholder={`Message #${activeChannel.name}`}
                            value={messageInput}
                            onChange={(v) => store.setMessageInput(v)}
                            onSend={() => store.sendMessage(messageInput)}
                            sending={sendingMessage}
                        />
                    </>
                ) : view === 'dms' && activeDmPubkey ? (
                    <>
                        <DmHeader pubkey={activeDmPubkey} conversations={dmConversations} />
                        <DmMessageList
                            messages={activeDmMessages}
                            loading={loadingMessages}
                            myPubkey={identity.public_key}
                        />
                        <MessageComposer
                            placeholder="Send a message..."
                            value={messageInput}
                            onChange={(v) => store.setMessageInput(v)}
                            onSend={() => store.sendDm(activeDmPubkey, messageInput)}
                            sending={sendingMessage}
                        />
                    </>
                ) : (
                    <EmptyState view={view} hasServers={servers.length > 0} />
                )}
            </div>

            {/* ─── Modals ──────────────────────────────────────────────────── */}
            {showCreateServer && <CreateServerModal />}
        </div>
    );
}

// ─── Sub Components ──────────────────────────────────────────────────────────

function ServerButton({ emoji, isActive, isHome, onClick, tooltip, unread }: {
    emoji: string;
    isActive: boolean;
    isHome?: boolean;
    onClick: () => void;
    tooltip?: string;
    unread?: boolean;
}) {
    return (
        <div className="relative group">
            {/* Active indicator pill */}
            <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white transition-all duration-200 ${isActive ? 'h-10' : unread ? 'h-2' : 'h-0 group-hover:h-5'}`} />

            <button
                onClick={onClick}
                className={`w-12 h-12 flex items-center justify-center text-lg transition-all duration-200
                    ${isActive
                        ? 'rounded-xl bg-blue-500/20 text-blue-400'
                        : isHome
                            ? 'rounded-3xl bg-zinc-800/60 hover:rounded-xl hover:bg-blue-500/20 hover:text-blue-400'
                            : 'rounded-3xl bg-zinc-800/60 hover:rounded-xl hover:bg-blue-500/20'
                    }`}
                title={tooltip}
            >
                <span className="group-hover:scale-110 transition-transform">{emoji}</span>
            </button>
        </div>
    );
}

function ServerChannelList({ server, textChannels, voiceChannels, activeChannelId, onSelectChannel, onCreateChannel, onSettings }: {
    server: { id: string; name: string };
    textChannels: Channel[];
    voiceChannels: Channel[];
    activeChannelId: string | null;
    onSelectChannel: (id: string) => void;
    onCreateChannel: () => void;
    onSettings: () => void;
}) {
    const [textCollapsed, setTextCollapsed] = useState(false);
    const [voiceCollapsed, setVoiceCollapsed] = useState(false);

    return (
        <>
            {/* Server Header */}
            <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800/30 shrink-0 cursor-pointer hover:bg-zinc-800/20 transition-colors" onClick={onSettings}>
                <span className="text-sm font-semibold text-zinc-200 truncate">{server.name}</span>
                <ChevronDown size={16} className="text-zinc-500" />
            </div>

            {/* Channel List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-4 scrollbar-thin">
                {/* Text Channels */}
                <div>
                    <button
                        onClick={() => setTextCollapsed(!textCollapsed)}
                        className="flex items-center gap-1 px-2 py-1 w-full hover:text-zinc-300 transition-colors group"
                    >
                        {textCollapsed ? (
                            <ChevronRight size={10} className="text-zinc-500" />
                        ) : (
                            <ChevronDown size={10} className="text-zinc-500" />
                        )}
                        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Text Channels</span>
                        <Plus
                            size={14}
                            className="ml-auto text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 transition-all"
                            onClick={(e) => { e.stopPropagation(); onCreateChannel(); }}
                        />
                    </button>
                    {!textCollapsed && textChannels.map(ch => (
                        <button
                            key={ch.id}
                            onClick={() => onSelectChannel(ch.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${activeChannelId === ch.id
                                ? 'bg-zinc-800/60 text-zinc-100'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                            }`}
                        >
                            <Hash size={16} className="shrink-0 text-zinc-600" />
                            <span className="truncate">{ch.name}</span>
                        </button>
                    ))}
                </div>

                {/* Voice Channels */}
                {voiceChannels.length > 0 && (
                    <div>
                        <button
                            onClick={() => setVoiceCollapsed(!voiceCollapsed)}
                            className="flex items-center gap-1 px-2 py-1 w-full hover:text-zinc-300 transition-colors"
                        >
                            {voiceCollapsed ? (
                                <ChevronRight size={10} className="text-zinc-500" />
                            ) : (
                                <ChevronDown size={10} className="text-zinc-500" />
                            )}
                            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Voice Channels</span>
                        </button>
                        {!voiceCollapsed && voiceChannels.map(ch => (
                            <button
                                key={ch.id}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
                            >
                                <Volume2 size={16} className="shrink-0 text-zinc-600" />
                                <span className="truncate">{ch.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

function DmList({ conversations, activePubkey, onSelect }: {
    conversations: DmConversation[];
    activePubkey: string | null;
    onSelect: (pubkey: string) => void;
}) {
    return (
        <>
            {/* DM Header */}
            <div className="h-12 px-3 flex items-center border-b border-zinc-800/30 shrink-0">
                <div className="flex-1 bg-zinc-800/40 rounded-md px-2 py-1.5 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-800/60 transition-colors">
                    Find or start a conversation
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {/* Section header */}
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Direct Messages</span>
                    <Plus size={14} className="text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors" />
                </div>

                {conversations.length === 0 ? (
                    <div className="px-2 py-8 text-center">
                        <p className="text-xs text-zinc-600">No conversations yet</p>
                        <p className="text-xs text-zinc-700 mt-1">Share your public key to start chatting</p>
                    </div>
                ) : (
                    conversations.map(conv => (
                        <button
                            key={conv.peer_pubkey}
                            onClick={() => onSelect(conv.peer_pubkey)}
                            className={`w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors ${activePubkey === conv.peer_pubkey
                                ? 'bg-zinc-800/60 text-zinc-100'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
                            }`}
                        >
                            <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center text-sm shrink-0">
                                {conv.peer_name?.[0]?.toUpperCase() || '👤'}
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <div className="text-sm font-medium truncate">
                                    {conv.peer_name || truncatePubkey(conv.peer_pubkey)}
                                </div>
                                <div className="text-xs text-zinc-600 truncate">{conv.last_message}</div>
                            </div>
                            {conv.unread_count > 0 && (
                                <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">
                                    {conv.unread_count}
                                </div>
                            )}
                        </button>
                    ))
                )}
            </div>
        </>
    );
}

function UserFooter({ identity }: { identity: { public_key: string; display_name: string; avatar_emoji: string } }) {
    const [showKey, setShowKey] = useState(false);

    return (
        <div className="h-14 px-2 flex items-center gap-2 bg-zinc-950/50 border-t border-zinc-800/30 shrink-0">
            <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center text-sm">
                {identity.avatar_emoji}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-zinc-200 truncate">{identity.display_name}</div>
                <button
                    onClick={() => {
                        navigator.clipboard.writeText(identity.public_key);
                        setShowKey(true);
                        setTimeout(() => setShowKey(false), 2000);
                    }}
                    className="text-[10px] text-zinc-600 hover:text-zinc-400 truncate transition-colors flex items-center gap-1"
                    title="Click to copy public key"
                >
                    {showKey ? 'Copied!' : truncatePubkey(identity.public_key)}
                    <Copy size={8} />
                </button>
            </div>
            <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Mic size={14} />
                </button>
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Headphones size={14} />
                </button>
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Settings size={14} />
                </button>
            </div>
        </div>
    );
}

function ChannelHeader({ channel }: { channel: Channel }) {
    return (
        <div className="h-12 px-4 flex items-center gap-3 border-b border-zinc-800/30 shrink-0">
            <Hash size={18} className="text-zinc-600" />
            <span className="text-sm font-semibold text-zinc-200">{channel.name}</span>
            {channel.description && (
                <>
                    <div className="w-px h-5 bg-zinc-800 mx-1" />
                    <span className="text-xs text-zinc-600 truncate">{channel.description}</span>
                </>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Bell size={16} />
                </button>
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Pin size={16} />
                </button>
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Users size={16} />
                </button>
                <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors">
                    <Search size={16} />
                </button>
            </div>
            {/* E2EE indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Lock size={10} className="text-emerald-400" />
                <span className="text-[10px] font-medium text-emerald-400">E2EE</span>
            </div>
        </div>
    );
}

function DmHeader({ pubkey, conversations }: { pubkey: string; conversations: DmConversation[] }) {
    const conv = conversations.find(c => c.peer_pubkey === pubkey);
    return (
        <div className="h-12 px-4 flex items-center gap-3 border-b border-zinc-800/30 shrink-0">
            <AtSign size={18} className="text-zinc-600" />
            <span className="text-sm font-semibold text-zinc-200">
                {conv?.peer_name || truncatePubkey(pubkey)}
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Lock size={10} className="text-emerald-400" />
                <span className="text-[10px] font-medium text-emerald-400">Double Ratchet E2EE</span>
            </div>
        </div>
    );
}

function MessageList({ messages, loading, myPubkey }: {
    messages: Message[];
    loading: boolean;
    myPubkey: string;
}) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    if (loading && messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-400 rounded-full animate-spin" />
            </div>
        );
    }

    if (messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2 max-w-xs">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mx-auto">
                        <Hash size={28} className="text-zinc-600" />
                    </div>
                    <p className="text-sm text-zinc-400">Welcome to the channel!</p>
                    <p className="text-xs text-zinc-600">This is the beginning of the conversation.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5 scrollbar-thin">
            {messages.map((msg, i) => {
                const prevMsg = messages[i - 1];
                const showHeader = !prevMsg ||
                    prevMsg.sender_pubkey !== msg.sender_pubkey ||
                    (msg.created_at - prevMsg.created_at) > 300;

                return (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        showHeader={showHeader}
                        isMe={msg.sender_pubkey === myPubkey}
                    />
                );
            })}
            <div ref={endRef} />
        </div>
    );
}

function DmMessageList({ messages, loading, myPubkey }: {
    messages: DirectMessage[];
    loading: boolean;
    myPubkey: string;
}) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    if (loading && messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-400 rounded-full animate-spin" />
            </div>
        );
    }

    if (messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2 max-w-xs">
                    <Shield size={28} className="text-blue-400 mx-auto" />
                    <p className="text-sm text-zinc-400">Start of your encrypted conversation</p>
                    <p className="text-xs text-zinc-600">Messages are encrypted end-to-end using the Signal protocol</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5 scrollbar-thin">
            {messages.map((dm, i) => {
                const prevDm = messages[i - 1];
                const showHeader = !prevDm ||
                    prevDm.sender_pubkey !== dm.sender_pubkey ||
                    (dm.created_at - prevDm.created_at) > 300;

                return (
                    <div
                        key={dm.id}
                        className={`group flex gap-3 py-0.5 px-2 rounded-md hover:bg-zinc-800/20 transition-colors ${showHeader ? 'mt-4' : ''}`}
                    >
                        {showHeader ? (
                            <div className="w-10 h-10 rounded-full bg-zinc-700/50 flex items-center justify-center text-base shrink-0">
                                {dm.sender_pubkey === myPubkey ? '🦊' : '👤'}
                            </div>
                        ) : (
                            <div className="w-10 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            {showHeader && (
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-sm font-semibold ${dm.sender_pubkey === myPubkey ? 'text-blue-400' : 'text-zinc-200'}`}>
                                        {dm.sender_name || truncatePubkey(dm.sender_pubkey)}
                                    </span>
                                    <span className="text-[10px] text-zinc-600">
                                        {formatTimestamp(dm.created_at)}
                                    </span>
                                </div>
                            )}
                            <p className="text-sm text-zinc-300 wrap-break-word">{dm.content}</p>
                        </div>
                    </div>
                );
            })}
            <div ref={endRef} />
        </div>
    );
}

function MessageBubble({ message, showHeader, isMe }: {
    message: Message;
    showHeader: boolean;
    isMe: boolean;
}) {
    const [showActions, setShowActions] = useState(false);

    // Color hash for consistent avatar colors
    const avatarColor = hashColor(message.sender_pubkey);

    return (
        <div
            className={`group flex gap-3 py-0.5 px-2 rounded-md hover:bg-zinc-800/20 transition-colors ${showHeader ? 'mt-4' : ''}`}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => setShowActions(false)}
        >
            {showHeader ? (
                <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: avatarColor }}
                >
                    {(message.sender_name?.[0] || '?').toUpperCase()}
                </div>
            ) : (
                <div className="w-10 shrink-0 flex items-center justify-center">
                    <span className="text-[10px] text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(message.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            )}

            <div className="flex-1 min-w-0 relative">
                {showHeader && (
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-sm font-semibold ${isMe ? 'text-blue-400' : 'text-zinc-200'}`}>
                            {message.sender_name || truncatePubkey(message.sender_pubkey)}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                            {formatTimestamp(message.created_at)}
                        </span>
                        {message.encrypted_blob && (
                            <Lock size={10} className="text-emerald-500/50" />
                        )}
                    </div>
                )}

                {/* Message content */}
                <p className="text-sm text-zinc-300 wrap-break-word leading-relaxed">{message.content}</p>

                {/* Hover actions */}
                {showActions && (
                    <div className="absolute -top-3 right-0 flex items-center gap-0.5 bg-zinc-800 rounded-md border border-zinc-700/50 shadow-lg">
                        <button className="p-1.5 hover:bg-zinc-700 rounded-l-md text-zinc-400 hover:text-zinc-200 transition-colors" title="React">
                            <Smile size={14} />
                        </button>
                        <button className="p-1.5 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors" title="Reply">
                            <Reply size={14} />
                        </button>
                        <button className="p-1.5 hover:bg-zinc-700 rounded-r-md text-zinc-400 hover:text-zinc-200 transition-colors" title="Copy">
                            <Copy size={14} onClick={() => navigator.clipboard.writeText(message.content)} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function MessageComposer({ placeholder, value, onChange, onSend, sending }: {
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    sending: boolean;
}) {
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !sending) onSend();
        }
    };

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
        }
    }, [value]);

    return (
        <div className="px-4 pb-4 pt-1 shrink-0">
            <div className="flex items-end gap-2 bg-zinc-800/40 rounded-xl px-4 py-2.5 border border-zinc-700/30 focus-within:border-zinc-600/50 transition-colors">
                <button className="text-zinc-500 hover:text-zinc-300 transition-colors pb-0.5">
                    <Paperclip size={18} />
                </button>

                <textarea
                    ref={inputRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-zinc-300 placeholder-zinc-600 outline-none resize-none max-h-50 leading-relaxed"
                />

                <button className="text-zinc-500 hover:text-zinc-300 transition-colors pb-0.5">
                    <Smile size={18} />
                </button>

                <button
                    onClick={() => { if (value.trim() && !sending) onSend(); }}
                    className={`pb-0.5 transition-colors ${value.trim() ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-600'}`}
                    disabled={!value.trim() || sending}
                >
                    {sending ? (
                        <div className="w-4.5 h-4.5 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
                    ) : (
                        <Send size={18} />
                    )}
                </button>
            </div>

            {/* Encryption badge */}
            <div className="flex items-center justify-center gap-1 mt-1.5">
                <Lock size={8} className="text-zinc-700" />
                <span className="text-[10px] text-zinc-700">End-to-end encrypted</span>
            </div>
        </div>
    );
}

function EmptyState({ view, hasServers }: { view: string; hasServers: boolean }) {
    const store = useMessagingStore();

    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-sm">
                <div className="w-20 h-20 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto">
                    {view === 'dms' ? (
                        <MessageSquare size={32} className="text-blue-400" />
                    ) : (
                        <Shield size={32} className="text-blue-400" />
                    )}
                </div>
                <div>
                    <h3 className="text-lg font-bold text-zinc-100 mb-1">
                        {view === 'dms' ? 'Your Direct Messages' : hasServers ? 'Select a Channel' : 'Create Your First Server'}
                    </h3>
                    <p className="text-sm text-zinc-500 leading-relaxed">
                        {view === 'dms'
                            ? 'Select a conversation or share your public key with someone to start chatting.'
                            : hasServers
                                ? 'Choose a server and channel from the sidebar to start messaging.'
                                : 'Servers in Onyx are fully decentralized and end-to-end encrypted. No account needed.'
                        }
                    </p>
                </div>
                {!hasServers && view === 'servers' && (
                    <button
                        onClick={() => store.setShowCreateServer(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                    >
                        <Plus size={16} />
                        Create Server
                    </button>
                )}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
                    <Lock size={10} />
                    Zero-Knowledge · No Account Required
                </div>
            </div>
        </div>
    );
}

function IdentitySetup() {
    const [name, setName] = useState('');
    const store = useMessagingStore();

    const handleCreate = async () => {
        await store.initIdentity(name || 'Anon');
    };

    return (
        <div className="flex-1 flex items-center justify-center bg-zinc-950">
            <div className="max-w-md w-full mx-4 space-y-6">
                <div className="text-center space-y-3">
                    <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center mx-auto">
                        <Shield size={36} className="text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-100">Onyx Messages</h2>
                    <p className="text-sm text-zinc-500 leading-relaxed">
                        Fully decentralized, end-to-end encrypted messaging. Your identity is a cryptographic
                        keypair generated on your device. No account, no email, no phone number required.
                    </p>
                </div>

                <div className="space-y-3 bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50">
                    <label className="block">
                        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Display Name</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Choose a display name..."
                            className="mt-1.5 w-full px-3 py-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500/50 transition-colors"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        />
                    </label>

                    <button
                        onClick={handleCreate}
                        className="w-full py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors"
                    >
                        Generate Identity
                    </button>

                    <div className="flex items-start gap-2 p-2 rounded-lg bg-zinc-800/30">
                        <Shield size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-zinc-500 leading-relaxed">
                            An Ed25519 cryptographic keypair will be generated locally. Your public key becomes your
                            identity. The private key never leaves your device.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CreateServerModal() {
    const [name, setName] = useState('');
    const [emoji, setEmoji] = useState('💬');
    const [creating, setCreating] = useState(false);
    const store = useMessagingStore();

    const emojiOptions = ['💬', '🎮', '💻', '🎵', '📚', '🎨', '🔬', '🚀', '🌙', '⚡', '🔥', '🌿'];

    const handleCreate = async () => {
        if (!name.trim()) return;
        setCreating(true);
        try {
            await store.createServer(name, emoji);
        } catch (e) {
            console.error('Create server failed:', e);
        }
        setCreating(false);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => store.setShowCreateServer(false)}>
            <div className="bg-zinc-900 rounded-2xl w-110 max-w-[90vw] shadow-2xl border border-zinc-800/50" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 pb-2 text-center">
                    <h2 className="text-xl font-bold text-zinc-100">Create a Server</h2>
                    <p className="text-sm text-zinc-500 mt-1">Your server is E2EE with a shared group key. No data is stored on any server.</p>
                </div>

                {/* Body */}
                <div className="px-6 py-4 space-y-4">
                    {/* Emoji picker */}
                    <div className="flex items-center gap-2 justify-center flex-wrap">
                        {emojiOptions.map(e => (
                            <button
                                key={e}
                                onClick={() => setEmoji(e)}
                                className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${emoji === e
                                    ? 'bg-blue-500/20 border border-blue-500/40 scale-110'
                                    : 'bg-zinc-800/40 hover:bg-zinc-800/60'
                                }`}
                            >
                                {e}
                            </button>
                        ))}
                    </div>

                    {/* Name input */}
                    <label className="block">
                        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Server Name</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My Server"
                            className="mt-1.5 w-full px-3 py-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500/50 transition-colors"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        />
                    </label>

                    <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                        <Lock size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-zinc-500 leading-relaxed">
                            A 256-bit AES group key will be generated. Only people you share this key with can read messages. 
                            Invite members by sharing the invite code via an E2EE direct message.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 flex items-center justify-between border-t border-zinc-800/30">
                    <button
                        onClick={() => store.setShowCreateServer(false)}
                        className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!name.trim() || creating}
                        className="px-6 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                    >
                        {creating ? 'Creating...' : 'Create Server'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function truncatePubkey(key: string): string {
    if (key.length <= 12) return key;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function formatTimestamp(epoch: number): string {
    const date = new Date(epoch * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
        return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (isYesterday) {
        return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
        ` ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function hashColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
        '#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245',
        '#3BA55C', '#FAA61A', '#E67E22', '#9B59B6', '#1ABC9C',
        '#E74C3C', '#2ECC71', '#3498DB', '#F1C40F', '#E91E63',
    ];
    return colors[Math.abs(hash) % colors.length];
}
