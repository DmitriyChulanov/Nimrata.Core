/**
 * Предлагает браузеру сохранить данные как файл
 *
 * @param blob - содержимое файла
 * @param fileName - предлагаемое имя файла
 */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    try {
        link.click();
    } finally {
        link.remove();
        URL.revokeObjectURL(url);
    }
}
