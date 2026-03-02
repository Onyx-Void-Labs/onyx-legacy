import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchReplaceStorage {
    searchTerm: string;
    replaceTerm: string;
    caseSensitive: boolean;
    results: { from: number; to: number }[];
    currentIndex: number;
}

export const searchReplacePluginKey = new PluginKey('searchReplace');

/**
 * Walks the ProseMirror document and finds all text matches for the given term.
 */
function findMatches(
    doc: any,
    searchTerm: string,
    caseSensitive: boolean
): { from: number; to: number }[] {
    if (!searchTerm) return [];

    const results: { from: number; to: number }[] = [];
    const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();

    doc.descendants((node: any, pos: number) => {
        if (!node.isText) return;
        const text = caseSensitive ? node.text! : node.text!.toLowerCase();
        let index = 0;
        while (index < text.length) {
            const found = text.indexOf(term, index);
            if (found === -1) break;
            results.push({
                from: pos + found,
                to: pos + found + searchTerm.length,
            });
            index = found + 1;
        }
    });

    return results;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        searchReplace: {
            setSearchTerm: (term: string) => ReturnType;
            setReplaceTerm: (term: string) => ReturnType;
            setCaseSensitive: (value: boolean) => ReturnType;
            nextSearchResult: () => ReturnType;
            previousSearchResult: () => ReturnType;
            replaceCurrentResult: () => ReturnType;
            replaceAllResults: () => ReturnType;
            clearSearch: () => ReturnType;
        };
    }
}

export const SearchReplace = Extension.create<Record<string, never>, SearchReplaceStorage>({
    name: 'searchReplace',

    addStorage() {
        return {
            searchTerm: '',
            replaceTerm: '',
            caseSensitive: false,
            results: [],
            currentIndex: 0,
        };
    },

    addCommands() {
        return {
            setSearchTerm:
                (term: string) =>
                ({ editor, tr, dispatch }) => {
                    this.storage.searchTerm = term;
                    this.storage.results = findMatches(
                        editor.state.doc,
                        term,
                        this.storage.caseSensitive
                    );
                    this.storage.currentIndex = 0;
                    if (dispatch) dispatch(tr);
                    return true;
                },

            setReplaceTerm:
                (term: string) =>
                () => {
                    this.storage.replaceTerm = term;
                    return true;
                },

            setCaseSensitive:
                (value: boolean) =>
                ({ editor, tr, dispatch }) => {
                    this.storage.caseSensitive = value;
                    this.storage.results = findMatches(
                        editor.state.doc,
                        this.storage.searchTerm,
                        value
                    );
                    this.storage.currentIndex = 0;
                    if (dispatch) dispatch(tr);
                    return true;
                },

            nextSearchResult:
                () =>
                ({ editor, tr, dispatch }) => {
                    const { results, currentIndex } = this.storage;
                    if (results.length === 0) return false;
                    const next = (currentIndex + 1) % results.length;
                    this.storage.currentIndex = next;
                    const match = results[next];
                    const dom = (editor.view as any).domAtPos(match.from);
                    if (dom && dom.node) {
                        const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    if (dispatch) dispatch(tr);
                    return true;
                },

            previousSearchResult:
                () =>
                ({ editor, tr, dispatch }) => {
                    const { results, currentIndex } = this.storage;
                    if (results.length === 0) return false;
                    const prev = (currentIndex - 1 + results.length) % results.length;
                    this.storage.currentIndex = prev;
                    const match = results[prev];
                    const dom = (editor.view as any).domAtPos(match.from);
                    if (dom && dom.node) {
                        const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    if (dispatch) dispatch(tr);
                    return true;
                },

            replaceCurrentResult:
                () =>
                ({ editor, tr, dispatch }) => {
                    const { results, currentIndex, replaceTerm } = this.storage;
                    if (results.length === 0) return false;
                    const match = results[currentIndex];

                    if (dispatch) {
                        tr.insertText(replaceTerm, match.from, match.to);
                        dispatch(tr);
                    }

                    // Recompute after replace
                    this.storage.results = findMatches(
                        editor.state.doc,
                        this.storage.searchTerm,
                        this.storage.caseSensitive
                    );
                    const newResults = this.storage.results;
                    if (newResults.length > 0) {
                        this.storage.currentIndex =
                            currentIndex >= newResults.length ? 0 : currentIndex;
                    } else {
                        this.storage.currentIndex = 0;
                    }
                    return true;
                },

            replaceAllResults:
                () =>
                ({ tr, dispatch }) => {
                    const { results, replaceTerm } = this.storage;
                    if (results.length === 0) return false;

                    // Replace from end to start so positions don't shift
                    const sortedResults = [...results].sort((a, b) => b.from - a.from);
                    if (dispatch) {
                        for (const match of sortedResults) {
                            tr.insertText(replaceTerm, match.from, match.to);
                        }
                        dispatch(tr);
                    }

                    this.storage.results = [];
                    this.storage.currentIndex = 0;
                    return true;
                },

            clearSearch:
                () =>
                ({ tr, dispatch }) => {
                    this.storage.searchTerm = '';
                    this.storage.replaceTerm = '';
                    this.storage.results = [];
                    this.storage.currentIndex = 0;
                    if (dispatch) dispatch(tr);
                    return true;
                },
        };
    },

    addProseMirrorPlugins() {
        const extensionThis = this;

        return [
            new Plugin({
                key: searchReplacePluginKey,
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply(tr, _oldDecos, _oldState, newState) {
                        // Recompute results on every doc change
                        const storage = extensionThis.storage;
                        if (tr.docChanged && storage.searchTerm) {
                            storage.results = findMatches(
                                newState.doc,
                                storage.searchTerm,
                                storage.caseSensitive
                            );
                            if (storage.currentIndex >= storage.results.length) {
                                storage.currentIndex = 0;
                            }
                        }

                        const { results, currentIndex } = storage;
                        if (!results.length) return DecorationSet.empty;

                        const decorations: Decoration[] = [];
                        results.forEach((match, i) => {
                            decorations.push(
                                Decoration.inline(match.from, match.to, {
                                    class:
                                        i === currentIndex
                                            ? 'search-result-current'
                                            : 'search-result',
                                })
                            );
                        });

                        return DecorationSet.create(newState.doc, decorations);
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },
            }),
        ];
    },
});
