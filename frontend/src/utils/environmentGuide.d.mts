export function environmentGuideMarkdown(guide: {
  title: string; version: string; summary: string; basis: string;
  comparisons: { item: string; local: string; baota: string; note: string }[];
  sections: { title: string; body: string[]; steps: string[]; commands: { label: string; code: string }[] }[];
  references: { title: string; url: string }[];
}): string;
