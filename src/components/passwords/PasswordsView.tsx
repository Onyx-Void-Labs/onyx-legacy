import {
    KeyRound, Plus, Search, Shield, Copy, Eye, EyeOff, Globe, Star, Trash2, Edit,
    Lock, Check, Type, Wifi, CreditCard, Terminal, Hash, FileText, Settings2, ShieldAlert,
    Dices
} from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { useVault } from '../../contexts/VaultContext';
import { PasswordPayload, VaultItemType, VaultCustomField } from '../../services/PasswordService';
import { v4 as uuidv4 } from 'uuid';

type VaultFilter = 'all' | 'favorites' | 'recent';

interface PasswordsViewProps {
    sidebarCollapsed?: boolean;
}

const strengthColors = {
    strong: 'bg-emerald-400',
    medium: 'bg-amber-400',
    weak: 'bg-red-400',
};

const TYPE_ICONS: Record<VaultItemType, React.ElementType> = {
    login: Globe,
    wifi: Wifi,
    card: CreditCard,
    ssh: Terminal,
    note: FileText
};

const TYPE_LABELS: Record<VaultItemType, string> = {
    login: 'Login',
    wifi: 'Wi-Fi Network',
    card: 'Credit Card',
    ssh: 'SSH Key',
    note: 'Secure Note'
};

const DEFAULT_ITEM: PasswordPayload = {
    type: 'login',
    name: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    isFavorite: false,
    strength: 'weak',
    customFields: [],
    lastUsed: Date.now()
};

const calculateStrength = (pass: string | undefined): 'weak' | 'medium' | 'strong' => {
    if (!pass) return 'weak';
    let score = 0;
    if (pass.length > 8) score++;
    if (pass.length > 12) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    if (score < 3) return 'weak';
    if (score < 5) return 'medium';
    return 'strong';
};

const generatePassword = (opts = { length: 16, numbers: true, symbols: true, uppercase: true }) => {
    let chars = 'abcdefghijklmnopqrstuvwxyz';
    if (opts.uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (opts.numbers) chars += '0123456789';
    if (opts.symbols) chars += '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let pwd = '';
    if (chars.length === 0) chars = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < opts.length; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
};

export default function PasswordsView({ sidebarCollapsed = false }: PasswordsViewProps) {
    const { passwords, addPassword, updatePassword, deletePassword, isLoading, isLocked } = useVault();

    // List State
    const [filter, setFilter] = useState<VaultFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

    // Editor State
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<PasswordPayload>(DEFAULT_ITEM);
    const [showPassword, setShowPassword] = useState(false);
    const [visibleCustomFields, setVisibleCustomFields] = useState<Set<string>>(new Set());
    const [emailDropdownOpen, setEmailDropdownOpen] = useState(false);
    const [plusMenuOpen, setPlusMenuOpen] = useState(false);

    // Generator State
    const [generatorOpen, setGeneratorOpen] = useState(false);
    const [genOpts, setGenOpts] = useState({ length: 12, numbers: true, symbols: true, uppercase: true });

    // Refs
    const plusMenuRef = useRef<HTMLDivElement>(null);

    // Close plus menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
                setPlusMenuOpen(false);
            }
        };
        if (plusMenuOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [plusMenuOpen]);

    // Filter Entries
    const filteredEntries = useMemo(() => {
        let result = passwords;
        if (filter === 'favorites') result = result.filter(e => e.isFavorite);
        if (filter === 'recent') {
            result = [...result].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 10);
        }

        if (deferredSearchQuery) {
            const q = deferredSearchQuery.toLowerCase();
            result = result.filter(entry =>
                entry.name.toLowerCase().includes(q) ||
                (entry.username && entry.username.toLowerCase().includes(q)) ||
                (entry.url && entry.url.toLowerCase().includes(q))
            );
        }
        return result;
    }, [passwords, filter, deferredSearchQuery]);

    const selectedEntry = passwords.find(p => p.id === selectedEntryId) || null;

    // Email Autofill Memory
    const recentEmails = useMemo(() => {
        const emails = passwords
            .map(p => p.username)
            .filter((u): u is string => !!u && u.trim() !== '');
        return Array.from(new Set(emails));
    }, [passwords]);

    const filteredEmails = useMemo(() => {
        if (!formData.username || formData.username.trim() === '') return recentEmails;
        return recentEmails.filter(e => e.toLowerCase().includes(formData.username!.toLowerCase()));
    }, [recentEmails, formData.username]);

    // Handlers
    const handleSelectRecord = (id: string) => {
        if (isEditing) {
            if (!confirm("Discard unsaved changes?")) return;
        }
        setSelectedEntryId(id);
        setIsEditing(false);
        setShowPassword(false);
        setVisibleCustomFields(new Set());
        setGeneratorOpen(false);
    };

    const handleNewRecord = (type: VaultItemType) => {
        setSelectedEntryId(null);
        setFormData({ ...DEFAULT_ITEM, type, lastUsed: Date.now() });
        setIsEditing(true);
        setShowPassword(false);
        setGeneratorOpen(false);
        setPlusMenuOpen(false);
    };

    const handleEditRecord = () => {
        if (!selectedEntry) return;
        setFormData({
            ...selectedEntry,
            customFields: selectedEntry.customFields || []
        });
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setGeneratorOpen(false);
    };

    const handleSaveRecord = async () => {
        if (!formData.name) return alert("Title is required.");

        try {
            const payload = {
                ...formData,
                strength: calculateStrength(formData.password)
            };

            if (selectedEntryId && selectedEntry) {
                await updatePassword(selectedEntryId, payload);
            } else {
                const newItem = await addPassword(payload);
                setSelectedEntryId(newItem.id);
            }
            setIsEditing(false);
            setGeneratorOpen(false);
        } catch (e) {
            console.error(e);
            alert("Failed to save. Is the vault loaded properly?");
        }
    };

    const handleDeleteRecord = async () => {
        if (!selectedEntry) return;
        if (confirm("Are you sure you want to delete this encrypted record forever?")) {
            await deletePassword(selectedEntry.id);
            setSelectedEntryId(null);
            setIsEditing(false);
            setGeneratorOpen(false);
        }
    };

    const handleCopy = async (text: string) => {
        if (!text) return;
        await navigator.clipboard.writeText(text);
    };

    const handleAddCustomField = (isSecret: boolean) => {
        const newField: VaultCustomField = {
            id: uuidv4(),
            label: isSecret ? 'Secret Field' : 'New Field',
            value: '',
            isSecret
        };
        setFormData(prev => ({
            ...prev,
            customFields: [...(prev.customFields || []), newField]
        }));
    };

    const updateCustomField = (id: string, updates: Partial<VaultCustomField>) => {
        setFormData(prev => ({
            ...prev,
            customFields: prev.customFields?.map(f => f.id === id ? { ...f, ...updates } : f)
        }));
    };

    const removeCustomField = (id: string) => {
        setFormData(prev => ({
            ...prev,
            customFields: prev.customFields?.filter(f => f.id !== id)
        }));
    };

    const toggleCustomFieldVisibility = (id: string) => {
        setVisibleCustomFields(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const runPasswordGeneration = () => {
        setFormData({ ...formData, password: generatePassword(genOpts) });
    };

    const weakPasswordsCount = useMemo(() => {
        return passwords.filter(p => p.password && calculateStrength(p.password) === 'weak').length;
    }, [passwords]);

    // Slider percentage calculaton
    const sliderPercentage = ((genOpts.length - 8) / (32 - 8)) * 100;

    // ─── Render: Locked State ───────────────────────────────────────────────
    if (isLocked) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-[#09090b]">
                <div className="text-center space-y-4 max-w-sm">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
                        <Lock size={28} className="text-red-400" />
                    </div>
                    <h2 className="text-xl font-bold text-zinc-100">Vault is Locked</h2>
                    <p className="text-sm text-zinc-500 leading-relaxed">
                        Your master key is unavailable. Please sign out and log back in to unlock your secure vault.
                    </p>
                </div>
            </div>
        );
    }

    // ─── Render: Editor Mode ──────────────────────────────────────────────────
    const renderEditor = () => (
        <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/3 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-fuchsia-500/5 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

            {/* Editor Header */}
            <div className="z-10 px-8 py-5 border-b border-white/5 bg-zinc-950/40 backdrop-blur-xl flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2 text-zinc-400">
                    {(() => {
                        const Icon = TYPE_ICONS[formData.type];
                        return <Icon size={16} />;
                    })()}
                    <span className="text-sm font-semibold tracking-wide uppercase">{TYPE_LABELS[formData.type]}</span>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={handleCancelEdit} className="text-sm font-medium text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSaveRecord} className="flex items-center gap-2 text-sm font-bold text-white bg-indigo-600/90 hover:bg-indigo-500 px-4 py-1.5 rounded-lg transition-colors shadow-inner">
                        <Check size={16} /> Save Record
                    </button>
                </div>
            </div>

            {/* Editor Scroll Area */}
            <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8 z-10">
                {/* Header (Title & Image) */}
                <div className="flex items-center gap-5">
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            placeholder="Descriptive Title"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full bg-transparent text-3xl font-bold text-white placeholder-zinc-700 border-none outline-none focus:ring-0 p-0"
                            autoFocus
                        />
                        <button
                            onClick={() => setFormData(p => ({ ...p, isFavorite: !p.isFavorite }))}
                            className={`absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors ${formData.isFavorite ? 'text-amber-400 hover:bg-amber-400/10' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-400'}`}
                        >
                            <Star size={20} className={formData.isFavorite ? "fill-amber-400" : ""} />
                        </button>
                    </div>
                </div>

                {/* Core Fields Grid */}
                <div className="flex flex-col gap-6 bg-zinc-900/40 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl ring-1 ring-white/5">
                    <div className="space-y-2 relative">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Username / Email</label>
                        <input
                            type="text"
                            value={formData.username || ''}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            onFocus={() => setEmailDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setEmailDropdownOpen(false), 200)}
                            className="w-full bg-zinc-950/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono shadow-inner"
                            placeholder="username@onyx.com"
                        />
                        {/* Autofill Dropdown - Searchable */}
                        {emailDropdownOpen && filteredEmails.length > 0 && (
                            <div className="absolute top-full mt-2 w-full bg-zinc-800 border border-white/10 p-1 rounded-xl shadow-xl z-20 overflow-hidden text-sm max-h-40 overflow-y-auto animate-in slide-in-from-top-1 fade-in">
                                {filteredEmails.map(email => (
                                    <div
                                        key={email}
                                        onMouseDown={() => {
                                            setFormData(prev => ({ ...prev, username: email }));
                                            setEmailDropdownOpen(false);
                                        }}
                                        className="px-3 py-2 rounded-lg hover:bg-zinc-700 cursor-pointer text-zinc-300 font-mono transition-colors"
                                    >
                                        {email}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2 flex flex-col">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Password</label>
                        <div className="flex items-center gap-2 bg-zinc-950/50 border border-white/10 rounded-xl px-4 py-3 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all group shadow-inner">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password || ''}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="flex-1 bg-transparent text-sm text-zinc-200 outline-none font-mono tracking-[0.2em] placeholder:tracking-normal"
                                placeholder={showPassword ? "Password" : "••••••••••••••••"}
                            />
                            {generatorOpen && (
                                <button
                                    onClick={runPasswordGeneration}
                                    className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/20 transition-all font-bold group-hover:animate-pulse"
                                    title="Regenerate Password"
                                >
                                    <Dices size={18} />
                                </button>
                            )}
                            <button
                                onClick={() => setGeneratorOpen(!generatorOpen)}
                                className={`p-1.5 rounded-lg transition-colors ${generatorOpen ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                                title="Password Generator Settings"
                            >
                                <Settings2 size={18} />
                            </button>
                            <button
                                onClick={() => setShowPassword(!showPassword)}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {/* Custom Generator UI Matching Mockup precisely */}
                        {generatorOpen && (
                            <div className="mt-2 bg-gradient-to-br from-indigo-500/10 to-transparent border border-indigo-500/20 rounded-xl p-6 space-y-6 animate-in slide-in-from-top-2 fade-in relative overflow-hidden ring-1 ring-white/5 shadow-2xl backdrop-blur-xl">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 blur-3xl pointer-events-none rounded-full" />
                                <div className="flex items-center justify-between relative z-10">
                                    <span className="text-[11px] font-bold text-indigo-300/80 uppercase tracking-widest flex items-center gap-2"><Settings2 size={14} /> Generator Setup</span>
                                </div>
                                <div className="space-y-6 relative z-10">
                                    <div className="flex items-center gap-5">
                                        <label className="text-sm font-semibold text-zinc-200 min-w-[80px]">Length: <span className="text-indigo-400">{genOpts.length}</span></label>
                                        <input
                                            type="range"
                                            min="8"
                                            max="32"
                                            value={genOpts.length}
                                            onChange={(e) => setGenOpts({ ...genOpts, length: parseInt(e.target.value) })}
                                            className="flex-1 h-[6px] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-indigo-500 [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer"
                                            style={{
                                                background: `linear-gradient(to right, #6366f1 ${sliderPercentage}%, #27272a ${sliderPercentage}%)`
                                            }}
                                        />
                                    </div>
                                    <div className="flex items-center gap-6 text-sm text-zinc-200 pt-1">
                                        <label className="flex items-center gap-2.5 cursor-pointer font-medium">
                                            <input type="checkbox" checked={genOpts.uppercase} onChange={(e) => setGenOpts({ ...genOpts, uppercase: e.target.checked })} className="w-[18px] h-[18px] rounded-md appearance-none checked:bg-indigo-500 bg-zinc-800 border-none outline-none relative before:content-['✓'] before:absolute before:text-white before:text-[11px] before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100 transition-colors" />
                                            Uppercase
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer font-medium">
                                            <input type="checkbox" checked={genOpts.numbers} onChange={(e) => setGenOpts({ ...genOpts, numbers: e.target.checked })} className="w-[18px] h-[18px] rounded-md appearance-none checked:bg-indigo-500 bg-zinc-800 border-none outline-none relative before:content-['✓'] before:absolute before:text-white before:text-[11px] before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100 transition-colors" />
                                            Numbers
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer font-medium">
                                            <input type="checkbox" checked={genOpts.symbols} onChange={(e) => setGenOpts({ ...genOpts, symbols: e.target.checked })} className="w-[18px] h-[18px] rounded-md appearance-none checked:bg-indigo-500 bg-zinc-800 border-none outline-none relative before:content-['✓'] before:absolute before:text-white before:text-[11px] before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100 transition-colors" />
                                            Symbols
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Live Strength */}
                        {formData.password && (
                            <div className="flex items-center gap-2 mt-2 px-1">
                                <div className="flex gap-1 flex-1 h-1.5">
                                    {[...Array(4)].map((_, j) => {
                                        const str = calculateStrength(formData.password);
                                        const active = j < (str === 'strong' ? 4 : str === 'medium' ? 2 : 1);
                                        return (
                                            <div
                                                key={j}
                                                className={`flex-1 rounded-full ${active ? strengthColors[str] : 'bg-zinc-800'}`}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Website URL / Domain</label>
                        <input
                            type="text"
                            value={formData.url || ''}
                            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                            className="w-full bg-zinc-950/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-indigo-400 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono shadow-inner"
                            placeholder="https://app.example.com"
                        />
                    </div>
                </div>

                {/* Custom Fields Section */}
                {formData.customFields && formData.customFields.length > 0 && (
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-white/5 pb-2">
                            Custom Fields
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {formData.customFields.map((field) => (
                                <div key={field.id} className="bg-zinc-900/50 p-4 rounded-xl border border-white/5 space-y-3 relative group shadow-inner">
                                    <button
                                        onClick={() => removeCustomField(field.id)}
                                        className="absolute right-3 top-3 p-1.5 rounded-lg text-zinc-600 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 transition-all"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                    <input
                                        type="text"
                                        value={field.label}
                                        onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                                        className="w-full bg-transparent text-[10px] font-bold uppercase tracking-widest text-zinc-500 outline-none placeholder-zinc-700"
                                        placeholder="Label Name"
                                    />
                                    <div className="flex items-center gap-2 bg-zinc-950/50 border border-white/10 rounded-lg px-3 py-2 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all">
                                        {field.isSecret ? <Lock size={12} className="text-amber-400/50" /> : <Type size={12} className="text-zinc-600" />}
                                        <input
                                            type={field.isSecret && !visibleCustomFields.has(field.id) ? 'password' : 'text'}
                                            value={field.value}
                                            onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                                            className="flex-1 bg-transparent text-sm text-zinc-300 outline-none font-mono"
                                            placeholder="Value..."
                                        />
                                        {field.isSecret && (
                                            <button
                                                onClick={() => toggleCustomFieldVisibility(field.id)}
                                                className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 transition-colors"
                                            >
                                                {visibleCustomFields.has(field.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Add Custom Fields Buttons */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleAddCustomField(false)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0a0f] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 text-sm font-medium transition-colors border border-white/5 shadow-inner"
                    >
                        <Type size={14} /> Add Text Field
                    </button>
                    <button
                        onClick={() => handleAddCustomField(true)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0a0f] text-zinc-400 hover:bg-white/5 hover:text-zinc-200 text-sm font-medium transition-colors border border-white/5 shadow-inner"
                    >
                        <Hash size={14} /> Add Secret Field
                    </button>
                </div>

                {/* Notes Block */}
                <div className="space-y-3 pt-6">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2"><FileText size={14} /> Secure Notes</label>
                    <textarea
                        value={formData.notes || ''}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="w-full h-40 bg-zinc-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-5 text-sm text-zinc-300 outline-none hover:border-white/20 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all resize-none leading-relaxed shadow-inner"
                        placeholder="Add secondary codes, recovery questions, or context..."
                    />
                </div>
            </div>
        </div>
    );

    // ─── Render: View Mode ──────────────────────────────────────────────────
    const renderViewer = () => (
        <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/3 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-fuchsia-500/5 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

            {selectedEntry ? (
                <>
                    {/* Header */}
                    <div className="z-10 px-10 pt-10 pb-6 border-b border-white/5 shrink-0 flex justify-between items-start bg-zinc-950/40 backdrop-blur-xl">
                        <div className="flex items-center gap-5">
                            <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 flex items-center justify-center text-3xl font-bold uppercase text-white shadow-xl border border-white/5 shadow-black/50">
                                {(() => {
                                    const Icon = TYPE_ICONS[selectedEntry.type || 'login'];
                                    return <Icon size={28} className="opacity-90 grayscale-[20%]" />;
                                })()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-2xl font-bold text-white tracking-tight">{selectedEntry.name}</h2>
                                    <button onClick={() => updatePassword(selectedEntry.id, { ...selectedEntry, isFavorite: !selectedEntry.isFavorite })} className="text-amber-400 hover:scale-110 transition-transform mt-1">
                                        <Star size={18} className={selectedEntry.isFavorite ? "fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]" : "opacity-30"} />
                                    </button>
                                </div>
                                {selectedEntry.url && (
                                    <a href={selectedEntry.url.startsWith('http') ? selectedEntry.url : `https://${selectedEntry.url}`} target="_blank" rel="noreferrer" className="text-sm text-indigo-400/80 hover:text-indigo-400 flex items-center gap-1 mt-0.5 group w-fit">
                                        {selectedEntry.url}
                                    </a>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleEditRecord}
                                className="px-4 py-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                            >
                                <Edit size={14} /> Edit
                            </button>
                            <button
                                onClick={handleDeleteRecord}
                                className="p-2.5 text-red-500/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors border border-transparent"
                                title="Delete Record"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Data Area */}
                    <div className="flex-1 overflow-y-auto px-10 py-8 space-y-6 z-10">
                        {/* Core Identifiers */}
                        <div className="bg-zinc-900/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5 shadow-2xl ring-1 ring-white/5">
                            {selectedEntry.username && (
                                <div className="p-5 flex items-center group hover:bg-white/5 transition-colors">
                                    <div className="w-1/3">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Username</span>
                                    </div>
                                    <div className="flex-1 flex justify-between items-center pl-5 border-l border-white/5">
                                        <span className="text-sm font-mono text-zinc-200">{selectedEntry.username}</span>
                                        <button onClick={() => handleCopy(selectedEntry.username || '')} className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/5 text-zinc-400 transition-all">
                                            <Copy size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {selectedEntry.password && (
                                <div className="p-5 flex items-center group hover:bg-white/5 transition-colors">
                                    <div className="w-1/3 space-y-2">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Password</span>
                                        {/* Minimal Strength Bar */}
                                        <div className="flex items-center gap-1.5 w-16">
                                            {[...Array(3)].map((_, j) => {
                                                const s = selectedEntry.strength || 'weak';
                                                const active = j < (s === 'strong' ? 3 : s === 'medium' ? 2 : 1);
                                                return <div key={j} className={`h-1 flex-1 rounded-full ${active ? strengthColors[s] : 'bg-zinc-800'}`} />;
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex-1 flex items-center gap-2 pl-5 border-l border-white/5">
                                        <span className="flex-1 text-base font-mono text-zinc-200 tracking-[0.2em] font-medium pt-1">
                                            {showPassword ? selectedEntry.password : '••••••••••••••••'}
                                        </span>
                                        <button onClick={() => setShowPassword(!showPassword)} className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all">
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                        <button onClick={() => handleCopy(selectedEntry.password || '')} className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/5 text-zinc-400 transition-all">
                                            <Copy size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Custom Fields Viewer Grid */}
                        {selectedEntry.customFields && selectedEntry.customFields.length > 0 && (
                            <div className="grid grid-cols-1 gap-4">
                                {selectedEntry.customFields.map((field) => (
                                    <div key={field.id} className="bg-zinc-900/40 backdrop-blur-md p-5 rounded-2xl border border-white/10 space-y-2 group shadow-2xl ring-1 ring-white/5">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{field.label}</span>
                                        <div className="flex justify-between items-center group-hover:bg-white/5 -mx-2 px-2 py-1.5 rounded-lg transition-colors">
                                            <span className={`text-sm font-mono flex-1 ${field.isSecret && !visibleCustomFields.has(field.id) ? 'text-zinc-500 tracking-[0.2em] pt-1' : 'text-emerald-400'}`}>
                                                {field.isSecret && !visibleCustomFields.has(field.id) ? '••••••••' : field.value}
                                            </span>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {field.isSecret && (
                                                    <button onClick={() => toggleCustomFieldVisibility(field.id)} className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors">
                                                        {visibleCustomFields.has(field.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                )}
                                                <button onClick={() => handleCopy(field.value)} className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all">
                                                    <Copy size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Notes */}
                        {selectedEntry.notes && (
                            <div className="pt-4">
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 border-b border-white/5 pb-2">Secure Notes</h4>
                                <div className="text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed px-2">
                                    {selectedEntry.notes}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                    <div className="w-20 h-20 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center mb-6 ring-1 ring-white/5 shadow-2xl">
                        <Shield className="w-10 h-10 text-indigo-500/50 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-zinc-200 mb-2">Vault Explorer</h3>
                    <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">
                        Select a record or press the plus button to securely create a new one. All data is securely locked with Zero-Knowledge encryption.
                    </p>
                </div>
            )}
        </div>
    );

    return (
        <div className="flex h-full w-full overflow-hidden bg-zinc-950 relative">
            {/* Left: Master List */}
            <div className={`shrink-0 z-20 transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? 'w-0 opacity-0 border-none' : 'w-[320px] opacity-100 border-r border-white/5'}`}>
                <div className="w-[320px] h-full flex flex-col bg-zinc-950/80 backdrop-blur-2xl">
                    {/* Search Header */}
                    <div className="px-5 pt-5 pb-4 shrink-0 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2 bg-zinc-900/50 rounded-full px-4 py-2.5 border border-white/10 focus-within:border-indigo-500/40 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all shadow-inner">
                                <Search size={16} className="text-zinc-500 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Search vault..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                                />
                            </div>
                            <div className="relative" ref={plusMenuRef}>
                                <button
                                    onClick={() => setPlusMenuOpen(!plusMenuOpen)}
                                    className={`p-3 rounded-xl transition-colors border shadow-sm ${plusMenuOpen || (isEditing && !selectedEntryId)
                                        ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                                        : 'bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                                        }`}
                                    title="Add New Item"
                                >
                                    <Plus size={18} />
                                </button>
                                {/* Vault Item Selector Dropdown */}
                                {plusMenuOpen && (
                                    <div className="absolute top-full left-0 md:right-0 md:left-auto mt-2 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                        <div className="p-1">
                                            {Object.entries(TYPE_LABELS).map(([key, label]) => {
                                                const Icon = TYPE_ICONS[key as VaultItemType];
                                                return (
                                                    <button
                                                        key={key}
                                                        onClick={() => handleNewRecord(key as VaultItemType)}
                                                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-white/5 hover:text-zinc-100 flex items-center gap-3 transition-colors"
                                                    >
                                                        <Icon size={16} className="text-zinc-500" />
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Filter Navigation */}
                        <div className="flex items-center gap-4 text-sm px-1 border-b border-white/5 pb-2">
                            {([
                                { key: 'all' as VaultFilter, label: `All (${passwords.length})` },
                                { key: 'favorites' as VaultFilter, label: `Favorites (${passwords.filter(p => p.isFavorite).length})` },
                                { key: 'recent' as VaultFilter, label: 'Recent' },
                            ]).map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilter(f.key)}
                                    className={`font-semibold transition-all ${filter === f.key
                                        ? 'text-indigo-400'
                                        : 'text-zinc-600 hover:text-zinc-400'
                                        }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* List Container */}
                    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 relative">
                        {isLoading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-[#09090b]/80 backdrop-blur-sm z-10 animate-pulse">
                                <Shield className="w-8 h-8 text-indigo-500/40 animate-spin" />
                            </div>
                        ) : filteredEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-8 text-center mt-10">
                                <KeyRound size={24} className="text-zinc-800 mb-3" />
                                <span className="text-sm font-medium text-zinc-600">No items found</span>
                            </div>
                        ) : (
                            filteredEntries.map((item) => {
                                const isSelected = item.id === selectedEntryId;
                                const TypeIcon = TYPE_ICONS[item.type || 'login'];

                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleSelectRecord(item.id)}
                                        // BUBBLE UI (Requested by user) - Reverting left border to soft bubbles
                                        className={`w-full px-4 py-3 rounded-2xl flex items-center gap-4 transition-all text-left ${isSelected
                                            ? 'bg-zinc-800/80 shadow-md'
                                            : 'hover:bg-zinc-900/60'
                                            }`}
                                    >
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 shadow-inner ${isSelected
                                            ? 'bg-zinc-700/80 text-white'
                                            : 'bg-zinc-900 border border-white/5 text-zinc-400'
                                            }`}>
                                            <TypeIcon size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-base font-bold truncate pr-3 tracking-tight ${isSelected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                                                    {item.name}
                                                </span>
                                                {/* Status Indicator bubble */}
                                                {item.strength && item.password && (
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${strengthColors[item.strength]}`} />
                                                )}
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-zinc-500 font-medium truncate max-w-[150px]">
                                                    {item.username || item.url || TYPE_LABELS[item.type]}
                                                </span>
                                                <span className="text-zinc-600 font-semibold">{item.isFavorite && <Star size={12} className="text-amber-500 fill-amber-500" />}</span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Vault Health Footer */}
                    <div className="px-5 py-4 border-t border-white/5 bg-zinc-950/50 shrink-0 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-zinc-500 text-xs font-semibold uppercase tracking-wider">
                            <ShieldAlert size={14} /> Vault Health
                        </div>
                        {weakPasswordsCount > 0 ? (
                            <div className="flex items-center gap-1.5 text-amber-500 text-xs font-bold">
                                <span>{weakPasswordsCount} Weak</span>
                            </div>
                        ) : (
                            <span className="text-emerald-500 text-xs font-bold">Secure</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Detail/Editor Pane */}
            {isEditing ? renderEditor() : renderViewer()}
        </div>
    );
}
