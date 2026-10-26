/**
 * Генерирует UUIDv7 (RFC 9562): 48 бит времени в миллисекундах и случайный хвост
 */
export function uuid7(now: number = Date.now()): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 48-битная метка времени, старшие байты первыми; деление вместо побитовых операций из-за 32-битного ограничения
    let time = now;
    for (let i = 5; i >= 0; i--) {
        bytes[i] = time % 256;
        time = Math.floor(time / 256);
    }
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
