/**
 * Мост между логикой Трекера (создаётся до React-дерева) и выбором узла в интерфейсе:
 * `reveal` передаётся в `registerTracker`, а `RevealBinding` внутри `SelectionProvider`
 * подключает к нему настоящий `reveal` платформы
 */
export interface RevealBridge {
    reveal(id: string): void;
    bind(handler: (id: string) => void): () => void;
}

export function createRevealBridge(): RevealBridge {
    let handler: ((id: string) => void) | null = null;
    return {
        reveal: (id) => handler?.(id),
        bind(next) {
            handler = next;
            return () => {
                if (handler === next) handler = null;
            };
        },
    };
}
