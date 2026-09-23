import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import type { ChatState, ChatTurn } from '../src/shared/help-chat.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Host = { tree: Element | null; render(): Element; unmount(): void };

// Exercise the actual component bodies. Only painting, hooks and the narrow
// IPC boundary are substituted; mutation handlers and event subscriptions are
// extracted from the source, so the test detects missing notifications/listeners.
test('chat recovery synchronizes both surfaces, rejects stale reads and detaches without refresh loops', { timeout: 5000 }, async () => {
  const target = new EventTarget();
  let reads = 0, notifications = 0;
  let saved: ChatTurn[] = [], unsaved: ChatTurn[] | null = null;
  let readOverride: (() => Promise<ChatState>) | undefined;
  const id = 'a'.repeat(64), item = { id, label: 'Paper A' };
  const turn = (id: string, reply: string): ChatTurn => ({
    id, reply, message: 'Question', context: '{}', createdAt: '2026-09-21T00:00:00.000Z',
    labels: [], images: [], status: 'complete'
  });
  const snapshot = (): ChatState => ({
    turns: [...(unsaved ?? saved)], needsSave: !!unsaved,
    notices: unsaved ? ['Needs saving'] : [], editorVersion: 'test'
  });
  const win = {
    editor: {
      chatState: async () => {
        assert(++reads < 100, 'refresh loop');
        return readOverride ? readOverride() : snapshot();
      },
      pendingChats: async () => unsaved ? [item] : [],
      pendingChat: async () => { assert(unsaved); return { ...item, turns: [...unsaved] }; },
      retryChat: async () => {
        assert(unsaved); saved = unsaved; unsaved = null; return snapshot();
      },
      clearChat: async () => { saved = []; unsaved = null; },
      recoverChat: async ({ action }: { action: 'retry' | 'copy' | 'discard' }) => {
        if (action === 'retry') { assert(unsaved); saved = unsaved; }
        if (action !== 'copy') unsaved = null;
      },
      previewChat: async () => ({ id: 'preview', context: '{}', labels: [], images: [] })
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target)
  };
  target.addEventListener('chat-persistence', () => notifications++);
  const React = {
    Fragment: 'Fragment',
    createElement: (type: unknown, props: Element['props'] | null, ...children: unknown[]): Element => ({
      type, props: props ?? {}, children: children.flat(Infinity)
    })
  };

  function mount(file: string, name: string, props: Record<string, unknown>): Host {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert(declaration, `Missing component ${name}`);
    const source = declaration.getText(tree).replace(/^export\s+/, '');
    const js = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS }
    }).outputText;
    let cursor = 0;
    const slots: any[] = [], deps: unknown[][] = [];
    const cleanups: (((() => void) | void))[] = [], effects: (() => void)[] = [];
    const host: Host = {
      tree: null,
      render() {
        cursor = 0; this.tree = component(props);
        while (effects.length) effects.shift()!();
        return this.tree!;
      },
      unmount() { for (const cleanup of cleanups) cleanup?.(); }
    };
    const useState = (initial: any) => {
      const k = cursor++; if (!(k in slots)) slots[k] = initial;
      return [slots[k], (value: any) => { slots[k] = typeof value === 'function' ? value(slots[k]) : value; }];
    };
    const useRef = (initial: unknown) => {
      const k = cursor++; if (!(k in slots)) slots[k] = { current: initial }; return slots[k];
    };
    const useEffect = (effect: () => (() => void) | void, values: unknown[]) => {
      const k = cursor++;
      if (!deps[k] || values.some((value, i) => value !== deps[k][i])) {
        deps[k] = values;
        effects.push(() => { cleanups[k]?.(); cleanups[k] = effect(); });
      }
    };
    const component = new Function(
      'useState', 'useRef', 'useEffect', 'React', 'window', 'useDialogFocus',
      'MarkdownText', 'ReadableArea', 'CHAT_LIMITS', 'messageOf', js + ';return ' + name
    )(useState, useRef, useEffect, React, win, () => {}, 'MarkdownText', 'ReadableArea', { images: 3 }, String);
    host.render(); return host;
  }

  const nodes = (node: unknown): Element[] => {
    if (!node || typeof node !== 'object') return [];
    const element = node as Element;
    return [element, ...element.children.flatMap(nodes)];
  };
  const button = (host: Host, label: string) => nodes(host.tree).find(n => n.type === 'button' && n.children.includes(label));
  const hasAnswer = (host: Host, text: string) => nodes(host.tree).some(n => n.type === 'MarkdownText' && n.props.text === text);
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  saved = [turn('old', 'Saved answer')]; unsaved = [...saved, turn('new', 'Unsaved answer')];
  const drawer = mount('src/renderer/HelpChatDrawer.tsx', 'Conversation', {
    paper: false, projectId: null, open: false, blocked: false, capture: () => ({}), status: '',
    send: async () => { unsaved = [...saved, turn('new', 'Generated answer')]; return unsaved.at(-1)!; }
  });
  const pending = mount('src/renderer/PendingChats.tsx', 'PendingChats', { projectId: null, status: '' });
  const settle = async () => { for (let i = 0; i < 3; i++) { await tick(); drawer.render(); pending.render(); } };
  const click = async (host: Host, label: string) => {
    const node = button(host, label); assert(node, label); assert(!node.props.disabled, label + ' disabled');
    node.props.onClick(); await settle();
  };
  const seed = async () => {
    saved = [turn('old', 'Saved answer')]; unsaved = [...saved, turn('new', 'Unsaved answer')];
    win.dispatchEvent(new Event('chat-persistence')); await settle();
  };

  try {
    await settle(); assert(button(pending, 'Review unsaved replies'));
    await click(drawer, 'Retry saving chat');
    assert(!button(pending, 'Review unsaved replies')); assert(!button(drawer, 'Retry saving chat'));
    assert(hasAnswer(drawer, 'Unsaved answer'));

    await seed(); await click(pending, 'Review unsaved replies'); await click(pending, 'Retry saving reply');
    assert(!button(drawer, 'Retry saving chat')); assert(!button(pending, 'Review unsaved replies'));

    await seed(); await click(pending, 'Review unsaved replies'); await click(pending, 'Discard…'); await click(pending, 'Discard unsaved reply');
    assert(!button(drawer, 'Retry saving chat')); assert(hasAnswer(drawer, 'Saved answer'));
    assert(!hasAnswer(drawer, 'Unsaved answer')); assert(!button(pending, 'Review unsaved replies'));

    await seed(); await click(drawer, 'Clear chat…'); await click(drawer, 'Clear conversation');
    assert(!button(pending, 'Review unsaved replies')); assert(!hasAnswer(drawer, 'Saved answer'));
    assert(!button(drawer, 'Retry saving chat'));

    const textarea = nodes(drawer.tree).find(n => n.type === 'textarea'); assert(textarea);
    textarea.props.onChange({ target: { value: 'New question' } }); await settle(); await click(drawer, 'Ask Codex');
    assert(button(pending, 'Review unsaved replies')); assert(button(drawer, 'Retry saving chat'));

    let release!: (state: ChatState) => void;
    const stale = snapshot(); readOverride = () => new Promise<ChatState>(resolve => { release = resolve; });
    win.dispatchEvent(new Event('chat-persistence')); await tick(); readOverride = undefined;
    saved = [turn('old', 'Saved answer')]; unsaved = null;
    win.dispatchEvent(new Event('chat-persistence')); await settle(); release(stale); await settle();
    assert(!button(drawer, 'Retry saving chat')); assert(!hasAnswer(drawer, 'Generated answer'));

    let rejectStale!: (error: Error) => void;
    readOverride = () => new Promise<ChatState>((_resolve, reject) => { rejectStale = reject; });
    win.dispatchEvent(new Event('chat-persistence')); await tick(); readOverride = undefined;
    win.dispatchEvent(new Event('chat-persistence')); await settle();
    rejectStale(new Error('Obsolete chat read failed')); await settle();
    const composer = nodes(drawer.tree).find(n => n.type === 'textarea'); assert(composer);
    composer.props.onChange({ target: { value: 'Continue after the successful refresh' } }); await settle();
    assert(!nodes(drawer.tree).some(n => n.props.role === 'alert' && n.children.includes('Obsolete chat read failed')));
    assert.equal(button(drawer, 'Ask Codex')?.props.disabled, false);

    const baselineReads = reads, baselineNotifications = notifications;
    await settle(); assert.equal(reads, baselineReads); assert.equal(notifications, baselineNotifications);
  } finally { drawer.unmount(); pending.unmount(); }
  const baselineReads = reads;
  win.dispatchEvent(new Event('chat-persistence')); await tick(); assert.equal(reads, baselineReads);
});
