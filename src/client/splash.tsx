import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="flex min-h-screen flex-col justify-center gap-4 bg-[#f7f8fa] px-5 text-[#1f2328] dark:bg-[#101214] dark:text-[#f2f4f7]">
      <div className="flex items-center gap-3">
        <img className="h-12 w-12 object-contain" src="/snoo.png" alt="Snoo" />
        <div>
          <p className="text-sm text-[#5f6b7a] dark:text-[#a7b0bd]">
            {context.username ?? 'moderator'}
          </p>
          <h1 className="text-2xl font-semibold">Supermodds</h1>
        </div>
      </div>
      <p className="max-w-md text-sm leading-6 text-[#5f6b7a] dark:text-[#a7b0bd]">
        A registered toolbox for moderator workflows.
      </p>
      <div className="flex items-center">
        <button
          className="h-10 rounded bg-[#d93900] px-4 text-sm font-semibold text-white transition hover:bg-[#bf3200]"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Open tools
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
