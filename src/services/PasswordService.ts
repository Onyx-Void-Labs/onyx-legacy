// src/services/PasswordService.ts
import { pb } from '../lib/pocketbase';
import { encryptData, decryptData } from './SecurityService';
import localforage from 'localforage';

export type PasswordStrength = 'weak' | 'medium' | 'strong';
export type VaultItemType = 'login' | 'wifi' | 'card' | 'ssh' | 'note';

export interface VaultCustomField {
    id: string;
    label: string;
    value: string;
    isSecret: boolean;
}

// The plaintext structure of the internal Payload object
export interface PasswordPayload {
    type: VaultItemType;
    name: string;
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
    customFields?: VaultCustomField[];
    isFavorite: boolean;
    strength?: PasswordStrength;
    lastUsed: number; // Unix timestamp
}

// The structure of the decrypted vault item returned to the UI
export interface VaultItem extends PasswordPayload {
    id: string;
    created: string;
    updated: string;
}

// Ensure unique instances for different users if needed
const store = localforage.createInstance({
    name: "OnyxVaultOfflineStore"
});

export const PasswordService = {
    // ─── 1. FETCH & SYNC (OFFLINE FIRST) ──────────────────────────────────────────

    /**
     * Loads passwords instantly from LocalStorage, then silently syncs with PocketBase in the background.
     */
    async getPasswords(masterKeyBase64: string): Promise<VaultItem[]> {
        if (!masterKeyBase64) return [];
        const userId = pb.authStore.model?.id || 'local_user';

        // 1. Instantly load from local DB
        const localCacheKey = `passwords_${userId}`;
        const localBlob = await store.getItem<string>(localCacheKey);
        let items: VaultItem[] = [];

        if (localBlob) {
            try {
                items = JSON.parse(localBlob);
            } catch (e) {
                console.error("Failed to parse local vault cache", e);
            }
        }

        // 2. Fetch fresh data from network in background (if online)
        if (userId !== 'local_user') {
            this.syncWithCloud(masterKeyBase64).catch(e => console.error("Cloud sync failed (Offline mode active)", e));
        }

        return items;
    },

    /**
     * Re-fetches from PocketBase, decrypts everything, saves to local DB.
     */
    async syncWithCloud(masterKeyBase64: string): Promise<VaultItem[]> {
        if (!pb.authStore.model?.id) throw new Error("Not authenticated");
        const userId = pb.authStore.model.id;

        try {
            // Fetch raw encrypted blobs
            const records = await pb.collection('passwords').getFullList({
                sort: '-updated',
            });

            // Decrypt every record
            const decryptedItems: VaultItem[] = [];
            for (const record of records) {
                try {
                    const decryptedJson = await decryptData(record.payload, masterKeyBase64);
                    const payload: PasswordPayload = JSON.parse(decryptedJson);

                    decryptedItems.push({
                        ...payload,
                        id: record.id,
                        created: record.created,
                        updated: record.updated
                    });
                } catch (e) {
                    console.error(`Failed to decrypt password record ${record.id}`, e);
                    // Skip unreadable records (e.g. wrong master key)
                }
            }

            // Save back to cache
            const localCacheKey = `passwords_${userId}`;
            await store.setItem(localCacheKey, JSON.stringify(decryptedItems));

            // Return latest array
            return decryptedItems;
        } catch (error) {
            console.error("PocketBase Sync Error:", error);
            throw error; // Let the caller UI know sync failed
        }
    },

    // ─── 2. CREATE ─────────────────────────────────────────────────────────────

    async createPassword(payload: PasswordPayload, masterKeyBase64: string): Promise<VaultItem> {
        const userId = pb.authStore.model?.id || 'local_user';
        const isOffline = userId === 'local_user';

        // 1. Encrypt Payload
        const encryptedPayload = await encryptData(JSON.stringify(payload), masterKeyBase64);

        let recordId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        let created = new Date().toISOString();
        let updated = created;

        if (!isOffline) {
            // 2. Push to Cloud
            const record = await pb.collection('passwords').create({
                user: userId,
                payload: encryptedPayload
            });
            recordId = record.id;
            created = record.created;
            updated = record.updated;
        }

        const newItem: VaultItem = {
            ...payload,
            id: recordId,
            created,
            updated
        };

        // 3. Update Local Cache instantly
        await this.appendLocalCache(newItem);

        return newItem;
    },

    // ─── 3. UPDATE ─────────────────────────────────────────────────────────────

    async updatePassword(id: string, payload: PasswordPayload, masterKeyBase64: string): Promise<VaultItem> {
        const userId = pb.authStore.model?.id || 'local_user';
        const isOffline = userId === 'local_user';

        // 1. Encrypt new payload
        const encryptedPayload = await encryptData(JSON.stringify(payload), masterKeyBase64);

        let created = new Date().toISOString();
        let updated = new Date().toISOString();

        if (isOffline) {
            // Recover original created date from cache
            const existingStr = await store.getItem<string>(`passwords_${userId}`);
            if (existingStr) {
                const existingItems: VaultItem[] = JSON.parse(existingStr);
                const match = existingItems.find(i => i.id === id);
                if (match) created = match.created;
            }
        } else if (!id.startsWith('local_')) {
            // 2. Push to cloud
            const record = await pb.collection('passwords').update(id, {
                payload: encryptedPayload
            });
            created = record.created;
            updated = record.updated;
        }

        const updatedItem: VaultItem = {
            ...payload,
            id,
            created,
            updated
        };

        // 3. Update Local Cache
        await this.updateLocalCache(updatedItem);

        return updatedItem;
    },

    // ─── 4. DELETE ─────────────────────────────────────────────────────────────

    async deletePassword(id: string): Promise<void> {
        const userId = pb.authStore.model?.id || 'local_user';
        const isOffline = userId === 'local_user';

        // Push to cloud
        if (!isOffline && !id.startsWith('local_')) {
            await pb.collection('passwords').delete(id);
        }

        // Update local cache
        await this.removeLocalCache(id);
    },

    // ─── LOCAL CACHE UTILS ───────────────────────────────────────────────────

    async appendLocalCache(item: VaultItem) {
        const userId = pb.authStore.model?.id || 'local_user';
        const key = `passwords_${userId}`;
        const existingStr = await store.getItem<string>(key);
        let items: VaultItem[] = existingStr ? JSON.parse(existingStr) : [];
        items = [item, ...items];
        await store.setItem(key, JSON.stringify(items));
    },

    async updateLocalCache(item: VaultItem) {
        const userId = pb.authStore.model?.id || 'local_user';
        const key = `passwords_${userId}`;
        const existingStr = await store.getItem<string>(key);
        if (!existingStr) return;

        let items: VaultItem[] = JSON.parse(existingStr);
        items = items.map(i => i.id === item.id ? item : i);
        await store.setItem(key, JSON.stringify(items));
    },

    async removeLocalCache(id: string) {
        const userId = pb.authStore.model?.id || 'local_user';
        const key = `passwords_${userId}`;
        const existingStr = await store.getItem<string>(key);
        if (!existingStr) return;

        let items: VaultItem[] = JSON.parse(existingStr);
        items = items.filter(i => i.id !== id);
        await store.setItem(key, JSON.stringify(items));
    }
};
