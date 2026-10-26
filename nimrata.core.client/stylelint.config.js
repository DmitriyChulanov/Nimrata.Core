/**
 * Правила стилей: значения оформления живут только в `src/platform/theme/tokens.css`,
 * остальной CSS ссылается на токены (см. docs/design-system.md).
 */

/** Литералы цвета, запрещённые вне tokens.css */
const COLOR_FUNCTIONS = [
    'rgb',
    'rgba',
    'hsl',
    'hsla',
    'hwb',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'color',
];

/** Файлы, которые ещё не переведены на токены; список сокращается на шаге 6 плана и пустеет к его концу */
const LEGACY_FILES = [
    'src/App.css',
    'src/platform/journal/Journal.css',
    'src/platform/properties/PropertyGrid.css',
    'src/platform/users/UsersTab.css',
];

export default {
    ignoreFiles: ['dist/**', 'node_modules/**'],
    rules: {
        'color-no-hex': true,
        'color-named': 'never',
        'function-disallowed-list': COLOR_FUNCTIONS,
        'declaration-property-value-disallowed-list': {
            'font-size': [/\d(px|rem|em)\b/],
            'font-weight': [/^\d+$/],
            'font-family': [/^(?!var\().+/],
            'border-radius': [/\d+(px|rem|em)/],
            'box-shadow': [/^(?!none$|var\().+/],
            '/^(margin|padding)(-.+)?$/': [/(^|\s)-?[1-9]\d*(\.\d+)?(px|rem|em)\b/],
            gap: [/(^|\s)[1-9]\d*(\.\d+)?(px|rem|em)\b/],
        },
    },
    overrides: [
        {
            // Единственное место, где разрешены литералы значений
            files: ['src/platform/theme/tokens.css'],
            rules: {
                'color-no-hex': null,
                'function-disallowed-list': null,
                'declaration-property-value-disallowed-list': null,
            },
        },
        {
            files: LEGACY_FILES,
            rules: {
                'declaration-property-value-disallowed-list': null,
            },
        },
    ],
};
