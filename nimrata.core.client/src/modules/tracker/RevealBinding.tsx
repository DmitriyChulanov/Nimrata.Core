import { useEffect } from 'react';

import { useSelection } from '@platform';

import type { RevealBridge } from './revealBridge';

/** Подключает мост Трекера к `reveal` выбора узлов; рисовать нечего */
export function RevealBinding({ bridge }: { bridge: RevealBridge }) {
    const { reveal } = useSelection();
    useEffect(() => bridge.bind(reveal), [bridge, reveal]);
    return null;
}
