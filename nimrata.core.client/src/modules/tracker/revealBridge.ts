/**
 * Мост между логикой Трекера (создаётся до React-дерева) и выбором узла в интерфейсе:
 * `reveal` передаётся в `registerTracker`, а `RevealBinding` внутри `SelectionProvider`
 * подключает к нему настоящий `reveal` платформы
 */
export interface RevealBridge {
    /** Показывает объект в дереве, если мост подключён */
    reveal(id: string): void;
    /** Подключает настоящий обработчик; возвращает функцию отключения */
    bind(handler: (id: string) => void): () => void;
}

/**
 * Создаёт мост без подключённого обработчика
 *
 * @returns мост; пока обработчик не подключён, `reveal` ничего не делает
 */
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
