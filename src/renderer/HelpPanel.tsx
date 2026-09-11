import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import guide from '../../docs/USER_GUIDE.md?raw';
import setup from '../../docs/SETUP.md?raw';
import faq from '../../docs/FAQ.md?raw';
import changelog from '../../CHANGELOG.md?raw';
import packageInfo from '../../package.json?raw';
import { findHelpSections, helpPlainText, helpSections, type HelpDocument } from './help-content.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './help-panel.css';

const editorVersion = (JSON.parse(packageInfo) as { version: string }).version;
const sections = [...helpSections(guide, 'guide'), ...helpSections(setup, 'setup'), ...helpSections(faq, 'faq'), ...helpSections(changelog, 'changelog')];
const titles: Record<HelpDocument, string> = { guide: 'Writing & review', setup: 'Setup', faq: 'FAQ & recovery', changelog: 'Changelog' };
type Props = { onClose(): void; disabled?: boolean };
function inline(value: string): ReactNode[] {
  return value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return <span key={index}>{link ? link[1] : part}</span>;
  });
}
export function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n'), blocks: ReactNode[] = []; let index = 0;
  while (index < lines.length) {
    const line = lines[index], key = index;
    if (!line.trim()) { index++; continue; }
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const code: string[] = []; index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) code.push(lines[index++]);
      index++; blocks.push(<pre key={key} tabIndex={0}>{code.join('\n')}</pre>); continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|\s*:?-/.test(lines[index + 1] ?? '')) {
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const heading = cells(line), rows: string[][] = []; index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(<div className="help-table" key={key}><table><thead><tr>{heading.map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const ordered = /^\d+\.\s+/.test(line), bullet = /^[-*]\s+/.test(line);
    if (ordered || bullet) {
      const items: string[] = [], pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++].replace(pattern, ''));
      blocks.push(ordered ? <ol key={key}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol> : <ul key={key}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>); continue;
    }
    if (line.startsWith('>')) { blocks.push(<blockquote key={key}>{inline(line.replace(/^>\s?/, ''))}</blockquote>); index++; continue; }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^\s*(?:[`~]{3,}|\||>|\d+\.\s|[-*]\s)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <>{blocks}</>;
}

export function HelpPanel({ onClose }: Props) {
  const [query, setQuery] = useState(''), [tab, setTab] = useState<HelpDocument | 'shortcuts'>('guide');
  const [selected, setSelected] = useState(sections.find(section => section.document === 'guide' && /first session/i.test(section.title))?.id ?? sections[0]?.id);
  const search = useRef<HTMLInputElement>(null), article = useRef<HTMLElement>(null), panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, { initialFocus: search });
  const choices = useMemo(() => query.trim() ? findHelpSections(sections, query) : sections.filter(section => tab === 'shortcuts' ? section.document === 'guide' && /keyboard shortcuts/i.test(section.title) : section.document === tab), [query, tab]);
  const current = choices.find(section => section.id === selected) ?? choices[0];
  useEffect(() => { article.current?.scrollTo({ top: 0 }); }, [current?.id]);
  return <div className="help-overlay"><section ref={panel} tabIndex={-1} className="help-panel" role="dialog" aria-modal="true" aria-labelledby="editor-help-title">
    <header><div><h2 id="editor-help-title">Help</h2><p className="help-version">Modern Codex Editor · Version {editorVersion}</p></div><button onClick={onClose}>Close</button></header>
    <div className="help-search"><input ref={search} type="search" aria-label="Search editor help" placeholder="Search help, shortcuts, or recovery…" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} />{query && <button onClick={() => { setQuery(''); search.current?.focus(); }}>Clear</button>}</div>
    <nav className="help-tabs" aria-label="Help topics">{(['guide', 'setup', 'faq', 'shortcuts', 'changelog'] as const).map(value => <button key={value} aria-pressed={!query && tab === value} onClick={() => { setQuery(''); setTab(value); }}>{value === 'shortcuts' ? 'Shortcuts' : titles[value]}</button>)}</nav>
    <div className="help-content"><nav className="help-sections" aria-label={query ? 'Help search results' : 'Guide sections'}>
      {query && <p role="status">{choices.length} matching {choices.length === 1 ? 'section' : 'sections'}</p>}
      {choices.map(section => <button key={section.id} aria-current={current?.id === section.id ? 'true' : undefined} onClick={() => setSelected(section.id)}><strong>{section.title}</strong>{query && <small>{titles[section.document]} · {helpPlainText(section.body).slice(0, 100)}…</small>}</button>)}
      {!choices.length && <p>No matching section. Try “save”, “preamble”, “PDF”, or “Codex”.</p>}
    </nav><article ref={article} tabIndex={0} aria-label="Help section">{current && <><p className="help-document-label">{titles[current.document]}</p><h3>{current.title}</h3><MarkdownText text={current.body} /></>}</article></div>
  </section></div>;
}
