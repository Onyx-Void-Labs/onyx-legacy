import '@testing-library/jest-dom';

// Mock IndexedDB for tests
import { vi } from 'vitest';

// Minimal IndexedDB mock for service tests
const stores = new Map<string, Map<string, unknown>>();

class MockIDBRequest {
    result: unknown = undefined;
    error: DOMException | null = null;
    onsuccess: (() => void) | null = null;
    onerror: (() => void) | null = null;

    _resolve(val: unknown) {
        this.result = val;
        this.onsuccess?.();
    }
}

class MockIDBObjectStore {
    private name: string;
    private data: Map<string, unknown>;

    constructor(name: string) {
        this.name = name;
        this.data = stores.get(name) ?? new Map();
        stores.set(name, this.data);
    }

    getAll() {
        const req = new MockIDBRequest();
        setTimeout(() => req._resolve(Array.from(this.data.values())), 0);
        return req;
    }

    get(key: string) {
        const req = new MockIDBRequest();
        setTimeout(() => req._resolve(this.data.get(key)), 0);
        return req;
    }

    add(value: Record<string, unknown>) {
        const key = value.id as string;
        this.data.set(key, value);
        const req = new MockIDBRequest();
        setTimeout(() => req._resolve(key), 0);
        return req;
    }

    put(value: Record<string, unknown>) {
        return this.add(value);
    }

    delete(key: string) {
        this.data.delete(key);
        const req = new MockIDBRequest();
        setTimeout(() => req._resolve(undefined), 0);
        return req;
    }

    createIndex() {
        return this;
    }

    index() {
        return {
            getAll: () => this.getAll(),
        };
    }
}

class MockIDBTransaction {
    objectStore(name: string) {
        return new MockIDBObjectStore(name);
    }
}

class MockIDBDatabase {
    objectStoreNames = {
        contains: () => false,
    };

    createObjectStore(name: string) {
        return new MockIDBObjectStore(name);
    }

    transaction() {
        return new MockIDBTransaction();
    }
}

const mockIndexedDB = {
    open: () => {
        const req = new MockIDBRequest();
        const db = new MockIDBDatabase();
        setTimeout(() => {
            req.result = db;
            (req as unknown as { onupgradeneeded?: () => void }).onupgradeneeded?.();
            req.onsuccess?.();
        }, 0);
        return req;
    },
};

vi.stubGlobal('indexedDB', mockIndexedDB);

// Mock crypto.randomUUID
if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
        value: {
            randomUUID: () =>
                'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = (Math.random() * 16) | 0;
                    const v = c === 'x' ? r : (r & 0x3) | 0x8;
                    return v.toString(16);
                }),
        },
    });
}
