import type { DeploymentGuide, GuideChapter, TutorialMedia } from "../views/tutorials/types";
export function filterChapters(chapters: GuideChapter[], query: string): GuideChapter[];
export function parseProgress(raw: string | null, validIds: string[]): string[];
export function guideMarkdown(guide: DeploymentGuide, media: Record<string, TutorialMedia>, mediaBase: string): string;
