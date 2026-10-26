import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TypeIcon } from './TypeIcon';

import type { TypeDefinition } from '@platform/types/types';

/**
 * Тип с иконкой и цветом для проверок
 */
const type = (extra: Partial<TypeDefinition>): TypeDefinition => ({
    id: 'T',
    name: 'Тип',
    module: 't',
    moduleVersion: 1,
    icon: 'folder',
    ...extra,
});

/**
 * Иконка типа: имя и цвет берутся из определения типа
 */
describe('TypeIcon: rendering', () => {
    /**
     * Проверяет, что цвет палитры из типа попадает в иконку
     */
    it('typeIcon_paletteColor_setsTone', () => {
        const { container } = render(<TypeIcon type={type({ iconColor: 'blue' })} />);

        const svg = container.querySelector('svg.lucide-folder');
        expect(svg).toHaveAttribute('data-tone', 'blue');
    });

    /**
     * Проверяет, что без цвета иконка наследует цвет текста
     */
    it('typeIcon_withoutColor_hasNoTone', () => {
        const { container } = render(<TypeIcon type={type({})} />);

        expect(container.querySelector('svg')).not.toHaveAttribute('data-tone');
    });

    /**
     * Проверяет, что цвет вне палитры игнорируется
     */
    it('typeIcon_unknownColor_isIgnored', () => {
        const { container } = render(<TypeIcon type={type({ iconColor: '#ff0000' })} />);

        expect(container.querySelector('svg')).not.toHaveAttribute('data-tone');
    });

    /**
     * Проверяет, что без типа показывается запасная иконка
     */
    it('typeIcon_withoutType_rendersFallback', () => {
        const { container } = render(<TypeIcon type={undefined} />);

        expect(container.querySelector('svg.lucide-circle')).not.toBeNull();
    });
});
