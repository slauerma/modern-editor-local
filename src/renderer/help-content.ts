// Help reads the bundled colleague guides. It never evaluates HTML or follows links.
export type HelpDocument = 'guide' | 'setup' | 'faq' | 'changelog';
export type HelpSection = { id: string; document: HelpDocument; title: string; body: string };
export function helpSections(markdown: string, document: HelpDocument): HelpSection[] {
  const sections: HelpSection[] = []; let current: HelpSection | null = null, fence = '';
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (fence === marker[0]) fence = ''; }
    const heading = !fence && !marker ? /^(#{1,3})\s+(.+)$/.exec(line) : null;
    if (heading) {
      if (current?.body.trim()) sections.push({ ...current, body: current.body.trim() });
      current = { id: `${document}-${sections.length}`, document, title: heading[2].trim(), body: '' };
    } else if (current) current.body += line + '\n';
  }
  if (current?.body.trim()) sections.push({ ...current, body: current.body.trim() });
  return sections;
}
export function findHelpSections(sections: HelpSection[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sections.filter(section => words.every(word => `${section.title}\n${section.body}`.toLocaleLowerCase().includes(word)));
}
export function helpPlainText(markdown: string) {
  return markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\s*[>|]+\s*/gm, '').trim();
}
