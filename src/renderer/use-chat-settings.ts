import { useEffect, useRef, useState } from 'react';
import { chatPreferencesSchema, type ChatPreferences } from '../shared/help-chat.ts';
import { effortSchema } from '../shared/contracts.ts';
import type { CodexModel } from '../shared/codex-models.ts';

const key = 'modern-editor.side-chat-settings.v1';
function savedPreferences(): ChatPreferences {
  try { return chatPreferencesSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null')); }
  catch { return { model: null, effort: 'medium', fastMode: false }; }
}

export function useChatSettings(open: boolean, blocked: boolean) {
  const [value, setValue] = useState(savedPreferences);
  const [models, setModels] = useState<CodexModel[] | null>(null), [appModel, setAppModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const live = useRef(true), loadingRef = useRef(false), attempted = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function refresh() {
    if (blocked || loadingRef.current) return;
    attempted.current = true; loadingRef.current = true; setLoading(true); setError('');
    try {
      const setup = await window.editor.getSetup();
      const available = await window.editor.listCodexModels(setup.settings);
      if (live.current) { setAppModel(setup.settings.codexModel ?? null); setModels(available); }
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { loadingRef.current = false; if (live.current) setLoading(false); }
  }
  useEffect(() => { if (open && !blocked && !attempted.current) void refresh(); }, [open, blocked]);
  const resolve = (id: string | null) => models?.find(m => id ? m.id === id : appModel ? m.id === appModel : m.isDefault);
  const selected = resolve(value.model);
  const efforts = effortSchema.options.filter(e => selected?.efforts.includes(e));
  const invalid = models && !selected ? 'Choose an available chat model or refresh the model list.'
    : selected && !efforts.includes(value.effort) ? 'Choose an effort supported by this chat model.'
    : selected && value.fastMode && !selected.fast ? 'This chat model supports Standard speed only.' : '';
  function change(patch: Partial<ChatPreferences>) {
    const next = { ...value, ...patch };
    if ('model' in patch) {
      const model = resolve(next.model), allowed = effortSchema.options.filter(e => model?.efforts.includes(e));
      if (allowed.length && !allowed.includes(next.effort)) next.effort = allowed.includes('medium') ? 'medium' : allowed[0];
      if (!model?.fast) next.fastMode = false;
    }
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* The current window can still use the chosen settings. */ }
  }
  return { value, models, selected, efforts, loading, error, invalid, change, refresh };
}
