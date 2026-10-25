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

describe('Workspace', () => {
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

    it('workspace_renders_threePanelsTreeTabsAndProperties', () => {
        renderWorkspace();

        expect(leftPanel()).toHaveTextContent('дерево');
        expect(screen.getByRole('region', { name: 'Вкладки' })).toHaveTextContent('вкладки');
        expect(rightPanel()).toHaveTextContent('свойства');
        expect(leftPanel()).toHaveStyle({ width: '300px' });
        expect(rightPanel()).toHaveStyle({ width: '320px' });
    });

    it('workspace_dragLeftBorder_changesTreeWidth', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseMove(document, { clientX: 380 });
        fireEvent.mouseUp(document);

        expect(leftPanel()).toHaveStyle({ width: '380px' });
        expect(leftHandle()).toHaveAttribute('aria-valuenow', '380');
    });

    it('workspace_dragRightBorderLeft_widensPropertyGrid', () => {
        renderWorkspace();

        fireEvent.mouseDown(rightHandle(), { clientX: 1000 });
        fireEvent.mouseMove(document, { clientX: 940 });
        fireEvent.mouseUp(document);

        expect(rightPanel()).toHaveStyle({ width: '380px' });
    });

    it('workspace_afterButtonRelease_mouseMoveDoesNotChangeWidth', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseUp(document);
        fireEvent.mouseMove(document, { clientX: 500 });

        expect(leftPanel()).toHaveStyle({ width: '300px' });
    });

    it('workspace_width_doesNotGoBelowMinimum', () => {
        renderWorkspace();

        fireEvent.mouseDown(leftHandle(), { clientX: 300 });
        fireEvent.mouseMove(document, { clientX: -500 });
        fireEvent.mouseUp(document);

        expect(leftPanel()).toHaveStyle({ width: '120px' });
    });

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
