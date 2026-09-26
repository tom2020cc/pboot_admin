export interface GuideCommand { label: string; code: string }
export interface GuideStep {
  id: string;
  title: string;
  body: string[];
  commands?: GuideCommand[];
  media?: string[];
  warning?: string;
  check: string;
}
export interface GuideChapter { id: string; title: string; group: string; intro: string; steps: GuideStep[] }
export interface DeploymentGuide {
  title: string;
  version: string;
  recordedAt: string;
  summary: string;
  scope: string;
  chapters: GuideChapter[];
  references: { title: string; url: string; note: string }[];
}
export interface TutorialMedia {
  kind: "screenshot" | "diagram";
  file: string;
  date?: string;
  caption: string;
  arrows?: { from: number[]; to: number[]; label: string }[];
}
