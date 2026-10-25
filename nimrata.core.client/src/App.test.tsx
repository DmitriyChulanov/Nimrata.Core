import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import App from './App';

afterEach(() => {
    vi.unstubAllGlobals();
});

it('показывает прогнозы, полученные с сервера', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
                { date: '2026-01-01', temperatureC: 0, temperatureF: 32, summary: 'Freezing' },
            ],
        }),
    );

    render(<App />);

    expect(await screen.findByText('Freezing')).toBeInTheDocument();
});
