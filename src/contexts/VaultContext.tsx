import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { PasswordService, VaultItem, PasswordPayload } from '../services/PasswordService';

interface VaultContextProps {
    passwords: VaultItem[];
    isLoading: boolean;
    isSyncing: boolean;
    error: string | null;
    refreshVault: () => Promise<void>;
    addPassword: (payload: PasswordPayload) => Promise<VaultItem>;
    updatePassword: (id: string, payload: PasswordPayload) => Promise<VaultItem>;
    deletePassword: (id: string) => Promise<void>;
    isLocked: boolean;
}

const VaultContext = createContext<VaultContextProps | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
    const [masterKey, setMasterKey] = useState<string | null>(null);
    const [passwords, setPasswords] = useState<VaultItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial Load
    useEffect(() => {
        let storedMk = localStorage.getItem('onyx_mk');

        // Fallback for offline or non-cloud users
        if (!storedMk) {
            let offlineMk = localStorage.getItem('onyx_offline_mk');
            if (!offlineMk) {
                const array = new Uint8Array(32);
                window.crypto.getRandomValues(array);
                offlineMk = btoa(String.fromCharCode.apply(null, Array.from(array)));
                localStorage.setItem('onyx_offline_mk', offlineMk);
            }
            storedMk = offlineMk;
        }

        setMasterKey(storedMk);

        if (!storedMk) {
            setPasswords([]);
            setIsLoading(false);
            return;
        }

        const initializeVault = async () => {
            setIsLoading(true);
            try {
                // Instantly load from IndexedDB cache
                const cachedItems = await PasswordService.getPasswords(storedMk);
                setPasswords(cachedItems);
            } catch (err: any) {
                console.error("Vault init error:", err);
                setError(err.message || 'Failed to initialize vault');
            } finally {
                setIsLoading(false);
                refreshVault(storedMk); // Trigger background cloud sync
            }
        };

        initializeVault();
    }, []);

    const refreshVault = async (keyOverride?: string) => {
        const keyToUse = keyOverride || masterKey;
        if (!keyToUse) return;
        setIsSyncing(true);
        setError(null);
        try {
            const freshItems = await PasswordService.syncWithCloud(keyToUse);
            setPasswords(freshItems);
        } catch (err: any) {
            console.error("Vault sync error:", err);
            // Don't show critical UI error for background sync failures, just log it.
        } finally {
            setIsSyncing(false);
        }
    };

    const addPassword = async (payload: PasswordPayload) => {
        if (!masterKey) throw new Error("Vault is locked");
        const newItem = await PasswordService.createPassword(payload, masterKey);
        setPasswords(prev => [newItem, ...prev]);
        return newItem;
    };

    const updatePassword = async (id: string, payload: PasswordPayload) => {
        if (!masterKey) throw new Error("Vault is locked");
        const updatedItem = await PasswordService.updatePassword(id, payload, masterKey);
        setPasswords(prev => prev.map(p => p.id === id ? updatedItem : p));
        return updatedItem;
    };

    const deletePassword = async (id: string) => {
        await PasswordService.deletePassword(id);
        setPasswords(prev => prev.filter(p => p.id !== id));
    };

    return (
        <VaultContext.Provider
            value={{
                passwords,
                isLoading,
                isSyncing,
                error,
                refreshVault,
                addPassword,
                updatePassword,
                deletePassword,
                isLocked: !masterKey
            }}
        >
            {children}
        </VaultContext.Provider>
    );
}

export function useVault() {
    const context = useContext(VaultContext);
    if (context === undefined) {
        throw new Error('useVault must be used within a VaultProvider');
    }
    return context;
}
