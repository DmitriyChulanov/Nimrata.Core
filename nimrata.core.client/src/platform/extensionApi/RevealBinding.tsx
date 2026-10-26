import { useEffect } from 'react';

import { useSelection } from '../selection/useSelection';

import type { RevealBridge } from './revealBridge';

/**
 * Подключает мост расширений к `reveal` выбора узлов; рисовать нечего
 *
 * @param props - мост, созданный `createRevealBridge`
 */
export function RevealBinding({ bridge }: { bridge: RevealBridge }) {
    const { reveal } = useSelection();
    useEffect(() => bridge.bind(reveal), [bridge, reveal]);
    return null;
}
