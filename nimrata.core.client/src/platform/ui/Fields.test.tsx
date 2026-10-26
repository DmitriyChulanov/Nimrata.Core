import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';
import { TextArea, TextField } from './TextField';

/**
 * Текстовое поле: связь подписи, подсказки и ошибки с элементом ввода
 */
describe('TextField: labelling', () => {
    /**
     * Проверяет, что подпись связана с полем и ввод доходит до обработчика
     */
    it('textField_label_isLinkedAndTypingCallsOnChange', async () => {
        const onChange = vi.fn();
        render(<TextField label="Название" onChange={onChange} />);

        await userEvent.type(screen.getByLabelText('Название'), 'а');

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    /**
     * Проверяет, что подсказка и ошибка описывают поле, а ошибка помечает его недопустимым
     */
    it('textField_hintAndError_describeInvalidControl', () => {
        render(<TextField label="Почта" hint="Рабочий адрес" error="Неверный адрес" />);

        const input = screen.getByLabelText('Почта');
        expect(input).toHaveAccessibleDescription('Рабочий адрес Неверный адрес');
        expect(input).toBeInvalid();
        expect(screen.getByRole('alert')).toHaveTextContent('Неверный адрес');
    });

    /**
     * Проверяет, что без подсказки и ошибки поле не описывается и не помечено недопустимым
     */
    it('textField_withoutMessages_hasNoDescriptionAndIsValid', () => {
        render(<TextField label="Имя" />);

        const input = screen.getByLabelText('Имя');
        expect(input).not.toHaveAttribute('aria-describedby');
        expect(input).not.toHaveAttribute('aria-invalid');
    });

    /**
     * Проверяет, что тип поля по умолчанию текстовый и его можно переопределить
     */
    it('textField_type_defaultsToTextAndCanBeOverridden', () => {
        render(
            <>
                <TextField label="Имя" />
                <TextField label="Пароль" type="password" />
            </>,
        );

        expect(screen.getByLabelText('Имя')).toHaveAttribute('type', 'text');
        expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
    });

    /**
     * Проверяет, что явный идентификатор используется для связи с подписью
     */
    it('textField_explicitId_isUsedForLabel', () => {
        render(<TextField id="email" label="Почта" />);

        expect(screen.getByLabelText('Почта')).toHaveAttribute('id', 'email');
    });
});

/**
 * Многострочное поле: те же связи, что у однострочного
 */
describe('TextArea: labelling', () => {
    /**
     * Проверяет, что поле — многострочное и имеет доступное описание
     */
    it('textArea_label_isTextboxWithDescription', () => {
        render(<TextArea label="Заметка" hint="Любой текст" />);

        const textbox = screen.getByRole('textbox', { name: 'Заметка' });
        expect(textbox.tagName).toBe('TEXTAREA');
        expect(textbox).toHaveAccessibleDescription('Любой текст');
    });
});

/**
 * Выпадающий список: подпись, варианты и пустой вариант
 */
describe('Select: options', () => {
    const options = [
        { value: 'a', label: 'Первый' },
        { value: 'b', label: 'Второй', disabled: true },
    ];

    /**
     * Проверяет, что выбор варианта вызывает обработчик со значением
     */
    it('select_choose_callsOnChangeWithValue', async () => {
        const onChange = vi.fn();
        render(<Select label="Порядок" options={options} onChange={onChange} />);

        await userEvent.selectOptions(screen.getByLabelText('Порядок'), 'a');

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Порядок')).toHaveValue('a');
    });

    /**
     * Проверяет, что placeholder добавляет пустой вариант, а без него его нет
     */
    it('select_placeholder_addsEmptyOptionOnlyWhenGiven', () => {
        const { rerender } = render(<Select label="Порядок" options={options} />);
        expect(screen.getAllByRole('option')).toHaveLength(2);

        rerender(<Select label="Порядок" options={options} placeholder="Не выбрано" />);

        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(screen.getByRole('option', { name: 'Не выбрано' })).toHaveValue('');
    });

    /**
     * Проверяет, что недоступный вариант отключён, а ошибка помечает список недопустимым
     */
    it('select_disabledOptionAndError_areReflected', () => {
        render(<Select label="Порядок" options={options} error="Выберите вариант" />);

        expect(screen.getByRole('option', { name: 'Второй' })).toBeDisabled();
        expect(screen.getByLabelText('Порядок')).toBeInvalid();
    });
});
