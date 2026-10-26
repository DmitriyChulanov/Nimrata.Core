import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Workspace } from './Workspace';

function renderWorkspace() {
    render(
        <Workspace
            left={<p>дерево</p>}
            center={<p>вкладки</p>}
            right={<p>свойства</p>}
            initialWidths={{ left: 300, right: 320 }}
        />,
    );
}

const leftPanel = () => screen.getByRole('region', { name: 'Дерево' });
const rightPanel = () => screen.getByRole('region', { name: 'Свойства' });
const leftHandle = () => screen.getByRole('separator', { name: 'Ширина дерева' });
const rightHandle = () => screen.getByRole('separator', { name: 'Ширина свойств' });

/**
 * Рабочая область
 */
describe('Workspace', () => {
    /**
     * Проверяет, что изменение ширины сообщает новые ширины панелей
     */
    it('workspace_widthChange_reportsNewPanelWidths', async () => {
        const onWidthsChange = vi.fn();
        render(
            <Workspace
                left={<p>дерево</p>}
                center={<p>вкладки</p>}
                right={<p>свойства</p>}
                initialWidths={{ left: 300, right: 320 }}
                onWidthsChange={onWidthsChange}
            />,
        );

        leftHandle().focus();
        await userEvent.setup().keyboard('{ArrowRight}');

        expect(onWidthsChange).toHaveBeenLastCalledWith({ left: 320, right: 320 });
    });

    /**
     * Проверяет, что показываются три панели: дерево, вкладки и свойства
     */
    it('workspace_renders_threePanelsTreeTabsAndProperties', () => {
        renderWorkspace();

        expect(leftPanel()).toHaveTextContent('дерево');
        expect(screen.getByRole('region', { name: 'Вкладки' })).toHaveTextContent('вкладки');
        expect(rightPanel()).toHaveTextContent('свойства');
        expect(leftPanel()).toHaveStyle({ width: '300px' });
        expect(rightPanel()).toHaveStyle({ width: '320px' });
    });

    /**
     * Проверяет, что перетаскивание левой границы меняет ширину дерева
     */
    it('workspace_dragLeftBorder_changesTreeWidth', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseMove(document, { clientX: 380 });
        fireEvent.mouseUp(document);

        expect(leftPanel()).toHaveStyle({ width: '380px' });
        expect(leftHandle()).toHaveAttribute('aria-valuenow', '380');
    });

    /**
     * Проверяет, что перетаскивание правой границы влево расширяет таблицу свойств
     */
    it('workspace_dragRightBorderLeft_widensPropertyGrid', () => {
        renderWorkspace();

        fireEvent.mouseDown(rightHandle(), { clientX: 1000 });
        fireEvent.mouseMove(document, { clientX: 940 });
        fireEvent.mouseUp(document);

        expect(rightPanel()).toHaveStyle({ width: '380px' });
    });

    /**
     * Проверяет, что после отпускания кнопки движение мыши ширину не меняет
     */
    it('workspace_afterButtonRelease_mouseMoveDoesNotChangeWidth', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseUp(document);
        fireEvent.mouseMove(document, { clientX: 500 });

        expect(leftPanel()).toHaveStyle({ width: '300px' });
    });

    /**
     * Проверяет, что ширина не опускается ниже минимума
     */
    it('workspace_width_doesNotGoBelowMinimum', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseMove(document, { clientX: -500 });
        fireEvent.mouseUp(document);

        expect(leftPanel()).toHaveStyle({ width: '120px' });
    });

    /**
     * Проверяет, что границы можно двигать стрелками на клавиатуре
     */
    it('workspace_borders_canBeMovedWithArrowKeys', async () => {
        const user = userEvent.setup();
        renderWorkspace();

        leftHandle().focus();
        await user.keyboard('{ArrowRight}{ArrowRight}');
        expect(leftPanel()).toHaveStyle({ width: '340px' });

        rightHandle().focus();
        await user.keyboard('{ArrowLeft}');
        expect(rightPanel()).toHaveStyle({ width: '340px' });
    });
});
