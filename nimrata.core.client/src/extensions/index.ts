// Встроенные расширения: единственное место, где они перечислены. Остальной код берёт
// расширения из реестра платформы (`extensionRegistry`) и конкретных не знает
import { extensionRegistry } from '@platform';

import { notesExtension } from '@notes/index';
import { tasksExtension } from '@tasks/index';

extensionRegistry.register(tasksExtension);
extensionRegistry.register(notesExtension);
