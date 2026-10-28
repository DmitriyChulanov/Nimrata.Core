import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Icon } from './Icon';

/**
 * Иконка реестра: поиск по имени, размеры и запасной вариант
 */
describe('Icon: rendering', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Проверяет, что известное имя рисует иконку Lucide, скрытую от вспомогательных технологий
     */
    it('icon_knownName_rendersDecorativeSvg', () => {
        const { container } = render(<Icon name="folder" />);

        const svg = container.querySelector('svg');
        expect(svg).toHaveClass('icon');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    /**
     * Проверяет, что с подписью иконка становится изображением, а не скрывается
     */
    it('icon_withAriaLabel_isExposedAsImage', () => {
        const { getByRole } = render(<Icon name="star" aria-label="Избранное" />);

        expect(getByRole('img', { name: 'Избранное' })).toBeInTheDocument();
    });

    /**
     * Проверяет, что малый и крупный размеры добавляют модификатор, а основной — нет
     */
    it('icon_size_addsModifierExceptDefault', () => {
        const { container } = render(
            <>
                <Icon name="x" size="sm" />
                <Icon name="x" />
                <Icon name="x" size="lg" />
            </>,
        );

        const [small, base, large] = Array.from(container.querySelectorAll('svg'));
        expect(small).toHaveClass('icon--sm');
        expect(base.getAttribute('class')).not.toMatch(/icon--/);
        expect(large).toHaveClass('icon--lg');
    });

    /**
     * Проверяет, что смысловой цвет попадает в атрибут иконки, а без него атрибута нет
     */
    it('icon_tone_setsDataAttributeOnlyWhenGiven', () => {
        const { container } = render(
            <>
                <Icon name="star" tone="yellow" />
                <Icon name="star" />
            </>,
        );

        const [colored, plain] = Array.from(container.querySelectorAll('svg'));
        expect(colored).toHaveAttribute('data-tone', 'yellow');
        expect(plain).not.toHaveAttribute('data-tone');
    });

    /**
     * Проверяет, что неизвестное имя даёт запасную иконку и одно предупреждение
     */
    it('icon_unknownName_rendersFallbackAndWarnsOnce', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { container } = render(
            <>
                <Icon name="нет-такой" />
                <Icon name="нет-такой" />
            </>,
        );

        const svgs = container.querySelectorAll('svg[data-icon="circle"]');
        expect(svgs).toHaveLength(2);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что без имени показывается запасная иконка без предупреждения
     */
    it('icon_withoutName_rendersFallbackSilently', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { container } = render(<Icon />);

        expect(container.querySelector('svg[data-icon="circle"]')).not.toBeNull();
        expect(warn).not.toHaveBeenCalled();
    });
});
