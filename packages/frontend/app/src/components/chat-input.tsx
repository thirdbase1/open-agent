import { Button, IconButton } from '@afk/component';
import {
  ArrowDownSmallIcon,
  ArrowUpBigIcon,
  PlusIcon,
} from '@blocksuite/icons/rc';
import { cssVarV2 } from '@toeverything/theme/v2';
import { EventEmitter } from 'events';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand';

import { cn } from '@/lib/utils';
import type { ChatSessionState } from '@/store/copilot/types';

import {
  ChatConfigMenu,
  defaultTools,
  useModels,
  fallbackModels,
} from './chat-config';
import { ContextPreview, ContextSelectorMenu } from './chat-context';
import * as styles from './chat-input.css';

export const chatInputEmitter = new EventEmitter();

export const ChatInput = ({
  onSend: propsOnSend,
  placeholder = 'What are your thoughts?',
  sending,
  streaming,
  onAbort,
  store,
  isCreating,
  initialInput,
}: {
  onSend: (input: string, config: { tools: string[]; model: string }) => void;
  onAbort?: () => void;
  placeholder?: string;
  sending?: boolean;
  streaming?: boolean;
  store?: StoreApi<ChatSessionState>;
  isCreating?: boolean;
  initialInput?: string;
}) => {
  const models = useModels();
  const [tools, setTools] = useState(defaultTools);
  const [model, setModel] = useState(fallbackModels[0].value);
  const [input, setInput] = useState(initialInput ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [textareaHeight, setTextareaHeight] = useState(45);

  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    textareaRef.current?.focus();
  }, []);

  const updateTextAreaHeight = useCallback(() => {
    const maxHeight = 120;
    const target = textareaRef.current;
    if (!target) return;
    target.style.height = 'auto';
    const height = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${height}px`;
    target.style.overflowY = 'auto';
    setTextareaHeight(height);
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateTextAreaHeight();
      setInput(e.currentTarget.value);
    },
    [updateTextAreaHeight]
  );

  const onSend = useCallback(
    (message?: string) => {
      const messageToSend = message ?? input;
      if (!messageToSend.trim()) return;
      propsOnSend(messageToSend, { tools, model });
      setInput('');
      setTimeout(() => {
        updateTextAreaHeight();
      }, 0);
    },
    [input, model, propsOnSend, tools, updateTextAreaHeight]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isEmpty = e.currentTarget.value.trim() === '';

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!isEmpty) {
          e.currentTarget.blur();
          onSend();
        }
      }
    },
    [onSend]
  );

  useEffect(() => {
    const onMessage = (message: string) => {
      onSend(message);
    };
    chatInputEmitter.on('send', onMessage);
    return () => {
      chatInputEmitter.off('send', onMessage);
    };
  }, [onSend, updateTextAreaHeight]);

  return (
    <div
      onClick={onClick}
      className={cn(
        styles.container,
        'transition duration-500 border rounded-2xl p-4 w-full'
      )}
    >
      <ContextPreview store={store} />
      <div className="w-full relative">
        <motion.div
          animate={{ height: textareaHeight }}
          layout
          transition={{ duration: 0.13, ease: 'easeOut' }}
        >
          <textarea
            name="chat-input"
            ref={textareaRef}
            rows={2}
            className={cn(
              'w-full resize-none bg-transparent',
              'focus:outline-none',
              'transition-[height] duration-150'
            )}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </motion.div>
        {input.length > 0 ? null : (
          <div
            style={{ color: cssVarV2('text/placeholder') }}
            className="absolute left-[2px] top-[2px] text-sm pointer-events-none flex items-center"
          >
            {placeholder}
          </div>
        )}
      </div>
      <footer className="flex items-center justify-between mt-2">
        <ContextSelectorMenu store={store}>
          <IconButton
            icon={<PlusIcon />}
            size="24"
            style={{ borderRadius: 8 }}
          />
        </ContextSelectorMenu>

        <div className="flex items-center gap-2">
          <ChatConfigMenu
            model={model}
            setModel={setModel}
            tools={tools}
            setTools={setTools}
          >
            <Button className={styles.modelSelector} variant="plain">
              <div className="flex items-center gap-1">
                {models.find(m => m.value === model)?.label}
                <ArrowDownSmallIcon className="text-xl" />
              </div>
            </Button>
          </ChatConfigMenu>
          {streaming ? (
            <IconButton
              icon={
                <div className="size-full flex items-center justify-center">
                  <div className="size-2 bg-white" />
                </div>
              }
              className={styles.abort}
              onClick={onAbort}
            />
          ) : (
            <IconButton
              disabled={!input.trim()}
              className={styles.send}
              icon={<ArrowUpBigIcon className="text-white" />}
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                onSend();
              }}
              loading={isCreating || sending}
            />
          )}
        </div>
      </footer>
    </div>
  );
};
