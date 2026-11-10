export const textEncodings = ['utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'macintosh'] as const;
export type TextEncoding = typeof textEncodings[number];
export const encodingLabels: Record<TextEncoding, string> = {
  'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252', 'iso-8859-1': 'ISO-8859-1 (Latin-1)', macintosh: 'Mac Roman'
};
export type TextImportChoice = { encoding: TextEncoding; text: string; limitation?: string };
export type TextImportPreview = {
  kind: 'text-import'; id: string; name: string; sourcePath: string;
  identified: boolean; choices: TextImportChoice[];
};
