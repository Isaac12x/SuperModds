import './index.css';

import { useEffect, useState } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo } from '@devvit/web/client';
import type { InitResponse, ModToolDescriptor, ToolsResponse } from '../shared/modTools';

type DashboardState = {
  username: string;
  subredditName: string | null;
  tools: ModToolDescriptor[];
  loading: boolean;
  error: string | null;
};

const categoryLabels: Record<ModToolDescriptor['category'], string> = {
  publishing: 'Publishing',
  workflow: 'Workflow',
};

const launchLabels: Record<ModToolDescriptor['launchMode'], string> = {
  menu: 'Menu action',
  form: 'Form action',
};

export const App = () => {
  const [state, setState] = useState<DashboardState>({
    username: 'moderator',
    subredditName: null,
    tools: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [initResponse, toolsResponse] = await Promise.all([
          fetch('/api/init'),
          fetch('/api/tools'),
        ]);

        if (!initResponse.ok) {
          throw new Error(`Init failed with HTTP ${initResponse.status}`);
        }

        if (!toolsResponse.ok) {
          throw new Error(`Tools failed with HTTP ${toolsResponse.status}`);
        }

        const initData: InitResponse = await initResponse.json();
        const toolsData: ToolsResponse = await toolsResponse.json();

        setState({
          username: initData.username,
          subredditName: initData.subredditName,
          tools: toolsData.tools,
          loading: false,
          error: null,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load moderator tools';

        setState((current) => ({
          ...current,
          loading: false,
          error: message,
        }));
      }
    };

    void loadDashboard();
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#1f2328] dark:bg-[#101214] dark:text-[#f2f4f7]">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-5 py-6 sm:px-8">
        <header className="flex flex-col gap-4 border-b border-[#d7dce2] pb-5 dark:border-[#30363d] sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-4">
            <img className="h-14 w-14 object-contain" src="/snoo.png" alt="Snoo" />
            <div>
              <p className="text-sm font-medium text-[#5f6b7a] dark:text-[#a7b0bd]">
                {state.subredditName ? `r/${state.subredditName}` : 'Moderator workspace'}
              </p>
              <h1 className="text-3xl font-semibold tracking-normal">
                Supermodds
              </h1>
            </div>
          </div>
          <div className="text-sm text-[#5f6b7a] dark:text-[#a7b0bd]">
            Signed in as <span className="font-medium">{state.username}</span>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Registered tools</h2>
              <span className="rounded border border-[#ccd3dc] px-2 py-1 text-xs text-[#5f6b7a] dark:border-[#3d444d] dark:text-[#a7b0bd]">
                {state.loading ? 'Loading' : `${state.tools.length} available`}
              </span>
            </div>

            {state.error ? (
              <div className="rounded border border-[#ffd0c2] bg-[#fff3ef] p-4 text-sm text-[#9b2f12] dark:border-[#7a3422] dark:bg-[#261712] dark:text-[#ffb9a5]">
                {state.error}
              </div>
            ) : null}

            <div className="grid gap-3">
              {state.loading
                ? ['Loading tools', 'Preparing registry'].map((label) => (
                    <div
                      className="min-h-28 rounded border border-[#d7dce2] bg-white p-4 dark:border-[#30363d] dark:bg-[#171a1f]"
                      key={label}
                    >
                      <div className="h-4 w-36 rounded bg-[#e6eaf0] dark:bg-[#2b3138]" />
                      <div className="mt-4 h-3 w-3/4 rounded bg-[#eef1f5] dark:bg-[#252a31]" />
                    </div>
                  ))
                : state.tools.map((tool) => (
                    <article
                      className="rounded border border-[#d7dce2] bg-white p-4 dark:border-[#30363d] dark:bg-[#171a1f]"
                      key={tool.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded bg-[#edf5ff] px-2 py-1 text-xs font-medium text-[#0b5cad] dark:bg-[#10233a] dark:text-[#9dccff]">
                              {categoryLabels[tool.category]}
                            </span>
                            <span className="rounded bg-[#eef8f0] px-2 py-1 text-xs font-medium text-[#276738] dark:bg-[#122719] dark:text-[#9fdbac]">
                              {launchLabels[tool.launchMode]}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold">{tool.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-[#5f6b7a] dark:text-[#a7b0bd]">
                            {tool.description}
                          </p>
                        </div>
                        <code className="shrink-0 rounded bg-[#f0f2f5] px-2 py-1 text-xs text-[#46515f] dark:bg-[#232830] dark:text-[#c6ced8]">
                          {tool.id}
                        </code>
                      </div>
                    </article>
                  ))}
            </div>
          </div>

          <aside className="flex flex-col gap-4 border-t border-[#d7dce2] pt-5 dark:border-[#30363d] md:border-l md:border-t-0 md:pl-5 md:pt-0">
            <div>
              <h2 className="text-lg font-semibold">Add the next tool</h2>
              <p className="mt-2 text-sm leading-6 text-[#5f6b7a] dark:text-[#a7b0bd]">
                Register server handlers in the tool registry, expose metadata through
                the dashboard API, then add the matching menu or form mapping in
                devvit.json.
              </p>
            </div>
            <button
              className="h-10 rounded bg-[#d93900] px-4 text-sm font-semibold text-white transition hover:bg-[#bf3200]"
              onClick={() => navigateTo('https://developers.reddit.com/docs/quickstart/quickstart-mod-tool')}
            >
              Devvit mod tool docs
            </button>
          </aside>
        </section>
      </div>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
