/**
 * Input bar rendering logic for the Agent Output View.
 *
 * Extracted to keep the main view file under 500 LoC.
 * Handles the textarea, send button, and cancel button.
 */

import { t } from '../../i18n';

export interface InputBarElements {
  inputBarEl: HTMLElement;
  inputTextareaEl: HTMLTextAreaElement;
  inputSendBtnEl: HTMLButtonElement;
  inputCancelBtnEl: HTMLButtonElement;
}

export interface InputBarOptions {
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

/**
 * Render the input bar (textarea + send/cancel buttons) into the
 * given root element. Returns references to the created elements.
 */
export function renderInputBar(
  root: HTMLElement,
  options: InputBarOptions,
): InputBarElements {
  const bar = root.createDiv({ cls: 'termy-agent-input-bar' });

  const textarea = bar.createEl('textarea', {
    cls: 'termy-agent-input',
    attr: {
      rows: '2',
      placeholder: t('agent.inputPlaceholder'),
      spellcheck: 'false',
    },
  });

  const actions = bar.createDiv({ cls: 'termy-agent-input-actions' });
  const sendBtn = actions.createEl('button', {
    cls: 'mod-cta termy-agent-send-btn',
    text: t('agent.sendButton'),
    attr: { type: 'button' },
  });

  const cancelBtn = actions.createEl('button', {
    cls: 'termy-agent-cancel-btn',
    text: t('agent.cancelButton'),
    attr: { type: 'button' },
  });

  const submit = (): void => {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    options.onSubmit(text);
  };

  sendBtn.addEventListener('click', () => submit());
  cancelBtn.addEventListener('click', () => options.onCancel());
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      submit();
    }
  });

  return {
    inputBarEl: bar,
    inputTextareaEl: textarea,
    inputSendBtnEl: sendBtn,
    inputCancelBtnEl: cancelBtn,
  };
}
