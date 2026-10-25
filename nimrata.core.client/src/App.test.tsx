import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';

afterEach(() => {
    vi.unstubAllGlobals();
});

it('показывает заглушку приложения и не обращается к серверу', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Nimrata' })).toBeInTheDocument();
    expect(screen.getByText(/интерфейс появится здесь/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
});
