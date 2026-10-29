import { useState } from 'react';

import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { useExtensions } from '@platform/extensionCatalog/useExtensions';
import { Icon } from '@platform/icons/Icon';
import { Button } from '@platform/ui';

import { commandItemsOf, planCommandOrder, writeCommandOrder } from './commandOrder';
import './Commands.css';

import type { DragEvent } from 'react';
import type { CommandDropPosition, CommandItem } from './commandOrder';

/**
 * Перетаскиваемая кнопка и текущая цель вставки
 */
interface DragState {
    /** Расширение-владелец блока: переносить можно только внутри него */
    extensionId: string;
    /** Ключ переносимой кнопки */
    key: string;
    /** Ключ кнопки-цели и положение вставки; `null`, пока указатель не над допустимой целью */
    drop: { key: string; position: CommandDropPosition } | null;
}

/**
 * Положение вставки по горизонтальной половине кнопки, над которой указатель
 *
 * @param event - событие перетаскивания над кнопкой
 * @returns `before` в левой половине, `after` в правой
 */
function positionIn(event: DragEvent<HTMLElement>): CommandDropPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
}

/**
 * Вкладка «Команды»: команды подключённых расширений блоками по расширениям. Расширения без
 * доступных команд скрыты, команды-шаблоны не показываются. Кнопки блока переставляются
 * перетаскиванием в пределах блока; первая перестановка превращает команды манифеста блока в
 * пользовательские с номерами (порядок задаёт номер объекта). Команда с параметрами открывает общий с
 * действиями диалог, ошибка запуска показывается вверху панели
 *
 * @returns панель команд или пустое состояние «Нет доступных команд»
 */
export function CommandsTab() {
    const data = useData();
    const { extensions } = useExtensions();
    const launcher = useActionLauncher();
    const [drag, setDrag] = useState<DragState | null>(null);
    const [orderError, setOrderError] = useState<string | null>(null);

    const blocks = extensions
        .filter((extension) => extension.connected)
        .map((extension) => ({ extension, items: commandItemsOf(data, extension) }))
        .filter((block) => block.items.length > 0);

    const reorder = async (
        extensionId: string,
        items: readonly CommandItem[],
        dragged: string,
        target: string,
        position: CommandDropPosition,
    ) => {
        const order = planCommandOrder(
            items.map((item) => item.key),
            dragged,
            target,
            position,
        );
        if (!order) return;
        setOrderError(null);
        const result = await data.perform((tx) => writeCommandOrder(tx, extensionId, items, order));
        if (!result.ok) setOrderError(result.error);
    };

    const error = launcher.error ?? orderError;

    return (
        <div className="commands">
            {error && <p role="alert">{error}</p>}
            {blocks.length === 0 && <p className="commands-empty">Нет доступных команд</p>}
            {blocks.map(({ extension, items }) => (
                <section
                    key={extension.id}
                    role="group"
                    aria-label={extension.name}
                    className="commands-block"
                >
                    <h3 className="commands-block-title">
                        <Icon name={extension.icon} />
                        {extension.name}
                    </h3>
                    <div className="commands-list">
                        {items.map((item) => {
                            const here = drag?.extensionId === extension.id;
                            const over = here && drag.drop?.key === item.key ? drag.drop : null;
                            return (
                                <Button
                                    key={item.key}
                                    icon={item.icon}
                                    title={item.description}
                                    draggable
                                    data-drop={over?.position}
                                    onClick={() =>
                                        void launcher.launchCommand(item.command, item.savedParams)
                                    }
                                    onDragStart={(e) => {
                                        e.dataTransfer?.setData('text/plain', item.key);
                                        setDrag({
                                            extensionId: extension.id,
                                            key: item.key,
                                            drop: null,
                                        });
                                    }}
                                    onDragOver={(e) => {
                                        if (!here || drag.key === item.key) return;
                                        e.preventDefault();
                                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                                        const position = positionIn(e);
                                        if (
                                            drag.drop?.key !== item.key ||
                                            drag.drop.position !== position
                                        ) {
                                            setDrag({ ...drag, drop: { key: item.key, position } });
                                        }
                                    }}
                                    onDrop={(e) => {
                                        if (!here) return;
                                        e.preventDefault();
                                        const dragged = drag.key;
                                        setDrag(null);
                                        void reorder(
                                            extension.id,
                                            items,
                                            dragged,
                                            item.key,
                                            positionIn(e),
                                        );
                                    }}
                                    onDragEnd={() => setDrag(null)}
                                >
                                    {item.label}
                                </Button>
                            );
                        })}
                    </div>
                </section>
            ))}
            {launcher.dialog}
        </div>
    );
}
