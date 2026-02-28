import { useState } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { usePlatform } from '../../../hooks/usePlatform';
import { X, ArrowLeft } from 'lucide-react';
import SettingsSidebar from './SettingsSidebar.tsx';
import AccountTab from './tabs/AccountTab.tsx';
import AppearanceTab from './tabs/AppearanceTab.tsx';
import EditorTab from './tabs/EditorTab.tsx';
import KeybindsTab from './tabs/KeybindsTab.tsx';
import AboutTab from './tabs/AboutTab.tsx';
import FeaturesTab from './tabs/FeaturesTab.tsx';
import DataTab from './tabs/DataTab.tsx';
import SecurityTab from './tabs/SecurityTab.tsx';
import SyncTab from './tabs/SyncTab.tsx';
import PhotosTab from './tabs/PhotosTab.tsx';
import CloudTab from './tabs/CloudTab.tsx';

interface SettingsModalProps {
    user: any;
    onLogout: () => void;
}

export default function SettingsModal({ user, onLogout }: SettingsModalProps) {
    const { isSettingsOpen, toggleSettings } = useSettings();
    const { isMobile } = usePlatform();
    const [activeTab, setActiveTab] = useState('account');
    const [showAuth, setShowAuth] = useState(false);
    // Mobile: null = show sidebar list, string = show that tab's content
    const [mobileActiveSection, setMobileActiveSection] = useState<string | null>(null);

    if (!isSettingsOpen) return null;

    const handleTabChange = (tabId: string) => {
        if (activeTab === tabId && tabId === 'account') {
            // "Back to Local" feature
            setShowAuth(false);
        } else {
            setActiveTab(tabId);
        }
        if (isMobile) {
            setMobileActiveSection(tabId);
        }
    };

    const handleMobileBack = () => {
        setMobileActiveSection(null);
    };

    const renderContent = () => (
        <>
            {activeTab === 'account' && (
                <AccountTab
                    user={user}
                    onLogout={onLogout}
                    showAuth={showAuth}
                    setShowAuth={setShowAuth}
                />
            )}
            {activeTab === 'security' && <SecurityTab />}
            {activeTab === 'appearance' && <AppearanceTab />}
            {activeTab === 'editor' && <EditorTab />}
            {activeTab === 'shortcuts' && <KeybindsTab />}
            {activeTab === 'features' && <FeaturesTab />}
            {activeTab === 'storage' && <DataTab />}
            {activeTab === 'sync' && <SyncTab />}
            {activeTab === 'photos' && <PhotosTab />}
            {activeTab === 'cloud' && <CloudTab />}
            {activeTab === 'about' && <AboutTab />}
        </>
    );

    // ─── Mobile: full-screen two-level stack ───────────────────────
    if (isMobile) {
        return (
            <div className="fixed inset-0 z-100 flex flex-col bg-[#09090b]">
                {/* Mobile header */}
                <div
                    className="flex items-center gap-2 px-3 shrink-0 border-b border-white/5"
                    style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(48px + env(safe-area-inset-top, 0px))' }}
                >
                    {mobileActiveSection ? (
                        <button
                            onClick={handleMobileBack}
                            className="p-2 text-zinc-400 hover:text-white rounded-lg transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                    ) : null}
                    <span className="text-sm font-semibold text-zinc-200 flex-1">
                        {mobileActiveSection ? activeTab.charAt(0).toUpperCase() + activeTab.slice(1) : 'Settings'}
                    </span>
                    <button
                        onClick={() => { toggleSettings(false); setMobileActiveSection(null); }}
                        className="p-2 text-zinc-500 hover:text-white rounded-full transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content: sidebar list or tab detail */}
                <div className="flex-1 overflow-y-auto mobile-scroll-container">
                    {mobileActiveSection === null ? (
                        <SettingsSidebar activeTab={activeTab} setActiveTab={handleTabChange} user={user} isMobile />
                    ) : (
                        <div className="p-4">
                            {renderContent()}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ─── Desktop: side-by-side layout ──────────────────────────────
    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
                onClick={() => toggleSettings(false)}
            />

            {/* Modal Container */}
            <div className="relative w-full max-w-5xl max-h-[90vh] h-175 bg-[#09090b] border border-white/5 rounded-3xl shadow-2xl flex overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Close Button */}
                <button
                    onClick={() => toggleSettings(false)}
                    className="absolute top-6 right-6 z-70 p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-full transition-all"
                >
                    <X size={20} />
                </button>

                {/* Sidebar */}
                <SettingsSidebar activeTab={activeTab} setActiveTab={handleTabChange} user={user} />

                {/* Content Area */}
                <div className="flex-1 flex flex-col overflow-hidden bg-black/20">
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
}
