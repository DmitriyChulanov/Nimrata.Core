import { useState } from 'react';

import { useTabs } from './TabsProvider';
import type { MenuItem, MenuRegistry, UserRole } from './registries';

import './Tabs.css';

interface MenuNode {
    label: string;
    item?: MenuItem;
    children: MenuNode[];
}

function buildTree(items: MenuItem[]): MenuNode[] {
    const root: MenuNode = { label: '', children: [] };
    for (const item of items) {
        let node = root;
        for (const label of item.path) {
            let child = node.children.find((c) => c.label === label);
            if (!child) {
                child = { label, children: [] };
                node.children.push(child);
            }
            node = child;
        }
        node.item = item;
    }
    return root.children;
}

export interface MainMenuProps {
    registry: MenuRegistry;
    role: UserRole;
}

/** Главное меню: строится из реестра, показывает только пункты, доступные роли. */
export function MainMenu({ registry, role }: MainMenuProps) {
    const { openTab } = useTabs();
    const [openPath, setOpenPath] = useState<string[]>([]);
    const nodes = buildTree(registry.listFor(role));

    const render = (list: MenuNode[], parents: string[]) =>
        list.map((node) => {
            const path = [...parents, node.label];
            const key = path.join('\u0000');
            const expanded =
                node.children.length > 0 &&
                openPath.length >= path.length &&
                path.every((label, i) => openPath[i] === label);
            return (
                <li key={key} role="none">
                    <button
                        type="button"
                        role="menuitem"
                        aria-haspopup={node.children.length > 0 ? 'menu' : undefined}
                        aria-expanded={node.children.length > 0 ? expanded : undefined}
                        onClick={() => {
                            if (node.children.length > 0) {
                                setOpenPath(expanded ? parents : path);
                            } else {
                                setOpenPath([]);
                                node.item?.run({ openTab });
                            }
                        }}
                    >
                        {node.label}
                    </button>
                    {expanded && <ul role="menu">{render(node.children, path)}</ul>}
                </li>
            );
        });

    return (
        <nav aria-label="Главное меню">
            <ul role="menubar" className="main-menu">
                {render(nodes, [])}
            </ul>
        </nav>
    );
}
