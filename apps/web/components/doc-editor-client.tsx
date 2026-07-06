'use client';

/**
 * Client-only boundary for the BlockSuite (Lit + Yjs CRDT) editor.
 *
 * BlockSuite's `DocEditor` registers Lit custom elements and touches `document`/`customElements`
 * at import time. Custom elements are a standard browser API with no SSR story - verified (web
 * search) that neither Vercel nor Next.js docs have a "Lit support" flag, because this isn't a
 * hosting-layer concern. The only requirement is: never let this module's import chain execute
 * during server rendering.
 *
 * `next/dynamic` with `ssr: false` guarantees the import only happens in the browser, after
 * hydration - the documented Next.js pattern for browser-only libraries.
 */
import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';

import type { DocEditor as DocEditorType } from '@afk/component/doc-composer';

const DocEditor = dynamic(
  () => import('@afk/component/doc-composer').then(m => m.DocEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading editor…
      </div>
    ),
  }
);

export function DocEditorClient(props: ComponentProps<typeof DocEditorType>) {
  return <DocEditor {...props} />;
}
