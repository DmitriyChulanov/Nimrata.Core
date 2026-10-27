import { useActionLauncher } from '@platform/actions/useActionLauncher';
import { useData } from '@platform/data/useData';
import { useExtensions } from '@platform/extensionCatalog/useExtensions';
import { Icon } from '@platform/icons/Icon';
import { Button } from '@platform/ui';

import { customCommandsOf, readCustomParams } from './customCommand';
import './Commands.css';

import type { CommandDefinition } from '@platform/types/types';

/**
 * Одна кнопка панели: обычная команда или сохранённая пользовательская
 */
interface CommandItem {
    /** Ключ элемента списка */
    key: string;
    /** Подпись кнопки */
    label: string;
    /** Всплывающее пояснение */
    description?: string;
    /** Имя иконки */
    icon: string;
    /** Команда манифеста, которую запускает кнопка */
    command: CommandDefinition;
    /** Сохранённые параметры пользовательской команды (диалог не нужен) */
    savedParams?: Record<string, unknown>;
}

/**
 * Вкладка «Команды»: команды подключённых расширений блоками по расширениям. Расширения без
 * доступных команд скрыты, команды-шаблоны не показываются, пользовательские команды стоят в блоке
 * своего расширения после команд манифеста. Команда с параметрами открывает общий с действиями
 * диалог, ошибка запуска показывается вверху панели
 *
 * @returns панель команд или пустое состояние «Нет доступных команд»
 */
export function CommandsTab() {
    const data = useData();
    const { extensions } = useExtensions();
    const launcher = useActionLauncher();

    const blocks = extensions
        .filter((extension) => extension.connected)
        .map((extension) => {
            const own: CommandItem[] = extension.commands
                .filter((command) => !command.template && data.isCommandAvailable(command.id))
                .map((command) => ({
                    key: command.id,
                    label: command.name,
                    description: command.description,
                    icon: command.icon,
                    command,
                }));
            const custom: CommandItem[] = [];
            for (const object of customCommandsOf(data, extension.id)) {
                const command = extension.commands.find((c) => c.id === object.properties.command);
                if (!command || !data.isCommandAvailable(command.id)) continue;
                const name = object.properties.name;
                custom.push({
                    key: `custom:${object.id}`,
                    label: typeof name === 'string' && name !== '' ? name : command.name,
                    description: command.description,
                    icon: command.icon,
                    command,
                    savedParams: readCustomParams(object),
                });
            }
            return { extension, items: [...own, ...custom] };
        })
        .filter((block) => block.items.length > 0);

    return (
        <div className="commands">
            {launcher.error && <p role="alert">{launcher.error}</p>}
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
                        {items.map((item) => (
                            <Button
                                key={item.key}
                                icon={item.icon}
                                title={item.description}
                                onClick={() =>
                                    void launcher.launchCommand(item.command, item.savedParams)
                                }
                            >
                                {item.label}
                            </Button>
                        ))}
                    </div>
                </section>
            ))}
            {launcher.dialog}
        </div>
    );
}
