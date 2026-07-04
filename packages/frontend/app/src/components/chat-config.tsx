import { Menu, MenuItem, MenuSeparator, MenuSub, Switch } from '@afk/component';
import {
  AiIcon,
  CodeIcon,
  MakeItRealIcon,
  PageIcon,
  SelectionIcon,
  ThinkingIcon,
  WebIcon,
} from '@blocksuite/icons/rc';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';

import { ChatGPTIcon } from '@/icons/chatgpt';
import { ClaudeIcon } from '@/icons/claude';
import { GeminiIcon } from '@/icons/gemini';

// Provider icon mapping
const providerIcons: Record<string, React.ReactNode> = {
  openai: <ChatGPTIcon />,
  anthropic: <ClaudeIcon />,
  anthropicVertex: <ClaudeIcon />,
  gemini: <GeminiIcon />,
  geminiVertex: <GeminiIcon />,
  fal: <AiIcon />,
  morph: <CodeIcon />,
  perplexity: <AiIcon />,
  oracle: <AiIcon />,
};

// Model display name mapping
function getModelLabel(modelId: string): string {
  return (
    modelId
      .replace('fal-ai/', '')
      .replace('anthropic/', '')
      .replace('google/', '')
      .split('/')
      .pop()
      ?.split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || modelId
  );
}

interface DynamicModel {
  provider: string;
  modelId: string;
  inputTypes: string[];
  outputTypes: string[];
}

// Fallback static models if API fails
export const fallbackModels = [
  {
    label: 'Claude Sonnet 4',
    value: 'claude-sonnet-4@20250514',
    icon: <ClaudeIcon />,
  },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro', icon: <GeminiIcon /> },
  { label: 'GPT-5', value: 'gpt-5', icon: <ChatGPTIcon /> },
  {
    label: 'Gemini 2.5 Flash',
    value: 'gemini-2.5-flash',
    icon: <GeminiIcon />,
  },
  { label: 'o4 Mini', value: 'o4-mini', icon: <ChatGPTIcon /> },
];

export function useModels() {
  const [models, setModels] = useState(fallbackModels);

  useEffect(() => {
    fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ listCopilotModels { provider modelId outputTypes } }`,
      }),
    })
      .then(r => r.json())
      .then(({ data }) => {
        if (data?.listCopilotModels?.length) {
          // Filter to text-generating models only
          const textModels = data.listCopilotModels.filter((m: DynamicModel) =>
            m.outputTypes.some(
              t =>
                t.includes('Text') ||
                t.includes('Object') ||
                t.includes('Structured')
            )
          );
          if (textModels.length > 0) {
            setModels(
              textModels.map((m: DynamicModel) => ({
                label: getModelLabel(m.modelId),
                value: m.modelId,
                icon: providerIcons[m.provider] || <AiIcon />,
              }))
            );
          }
        }
      })
      .catch(() => {});
  }, []);

  return models;
}

export const configurableTools = [
  {
    label: 'Code Artifact',
    icon: <CodeIcon />,
    value: 'codeArtifact',
  },
  {
    label: 'Make It Real',
    icon: <MakeItRealIcon />,
    value: 'makeItReal',
  },
  {
    label: 'Doc Compose',
    icon: <PageIcon />,
    value: 'docCompose',
  },
  {
    label: 'Web Search',
    icon: <WebIcon />,
    value: 'webSearch',
  },
  {
    label: 'Python',
    icon: <CodeIcon />,
    value: ['pythonCoding', 'pythonSandbox'],
  },
  {
    label: 'Agent Browser',
    icon: <SelectionIcon />,
    value: 'browserUse',
  },
  {
    label: 'Task Analysis',
    icon: <ThinkingIcon />,
    value: 'taskAnalysis',
  },
  {
    label: 'Web Fetch',
    icon: <WebIcon />,
    value: 'webFetch',
  },
  {
    label: 'URL Scanner',
    icon: <WebIcon />,
    value: 'urlScanner',
  },
  {
    label: 'Quick Compute',
    icon: <CodeIcon />,
    value: 'quickCompute',
  },
  {
    label: 'Design Generator',
    icon: <MakeItRealIcon />,
    value: 'designGenerator',
  },
  {
    label: 'Design System',
    icon: <MakeItRealIcon />,
    value: 'designSystem',
  },
  {
    label: 'Visual Polish',
    icon: <MakeItRealIcon />,
    value: 'visualPolish',
  },
];

export const defaultTools = [
  'conversationSummary',
  'todoList',
  'markTodo',
  'docEdit',
  'choose',
  ...configurableTools.map(tool => tool.value).flat(),
];

export const ChatConfigMenu = ({
  model,
  setModel,
  children,
  tools,
  setTools,
}: {
  children: React.ReactNode;
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  tools: string[];
  setTools: Dispatch<SetStateAction<string[]>>;
}) => {
  const tempModels = useModels();

  return (
    <Menu
      contentOptions={{
        style: { padding: 0 },
      }}
      items={
        <div>
          <div className="flex flex-col px-2 pt-2">
            <MenuSub
              items={tempModels.map(m => (
                <MenuItem
                  key={m.value}
                  onClick={() => setModel(m.value)}
                  prefixIcon={m.icon}
                  selected={model === m.value}
                >
                  {m.label}
                </MenuItem>
              ))}
              triggerOptions={{
                prefixIcon: <AiIcon />,
              }}
              subContentOptions={{
                sideOffset: 14,
                alignOffset: -8,
              }}
            >
              Foundation Model
            </MenuSub>
          </div>
          <MenuSeparator />
          <div className="flex flex-col gap-1 items-stretch px-2 pb-2 w-full">
            {configurableTools.map(tool => {
              const toolNames = Array.isArray(tool.value)
                ? tool.value
                : [tool.value];
              const isEnabled = toolNames.every(name => tools.includes(name));
              return (
                <div
                  className="flex gap-2 items-center w-full"
                  style={{ minWidth: 'min(100vw, 300px)' }}
                  key={tool.label}
                >
                  <div className="size-6 text-xl text-icon-primary flex items-center justify-center">
                    {tool.icon}
                  </div>
                  <div className="flex-1">{tool.label}</div>
                  <Switch
                    size={20}
                    checked={isEnabled}
                    onClick={e => {
                      e.stopPropagation();
                    }}
                    onChange={checked => {
                      if (checked) {
                        setTools(prev =>
                          Array.from(new Set([...prev, ...toolNames]))
                        );
                      } else {
                        setTools(prev =>
                          prev.filter(name => !toolNames.includes(name))
                        );
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      }
    >
      {children}
    </Menu>
  );
};
