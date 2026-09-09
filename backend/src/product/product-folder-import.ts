import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { readFolderParameters, FolderParameters, FolderParameterType, matchesProductModel } from './product-folder-parameters';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_SCANNED_DIRECTORIES = 5000;
const MAX_PRODUCT_FOLDERS = 1000;
const MAX_DETAIL_HTML_BYTES = 10 * 1024 * 1024;

export type ProductFolderCandidate = {
  modelName: string;
  directory: string;
  relativePath: string;
  thumbnailImageFile: string;
  thumbnailSourceFile: string;
  largeImageFile: string;
  carouselImageFiles: string[];
  detailHtmlFile: string;
  detailImageFiles: string[];
  warnings: string[];
  parameters: FolderParameters;
};

const cleanInputPath = (value: string) => String(value || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2');

const findNumberedImage = (files: fs.Dirent[], number: string) => {
  for (const extension of IMAGE_EXTENSIONS) {
    const match = files.find((file) => file.isFile() && file.name.toLowerCase() === `${number}${extension}`);
    if (match) return match.name;
  }
  return '';
};

const findDetailHtml = (files: fs.Dirent[], modelName: string) => {
  const htmlFiles = files
    .filter((file) => file.isFile() && /\.html?$/i.test(file.name) && (matchesProductModel(file.name, modelName) || /_index\.html?$/i.test(file.name)))
    .map((file) => file.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const expected = `${modelName}_index.html`.toLowerCase();
  return htmlFiles.find((file) => file.toLowerCase() === expected)
    || htmlFiles.find((file) => matchesProductModel(file, modelName) && /index/i.test(file))
    || htmlFiles.find((file) => matchesProductModel(file, modelName)) || htmlFiles[0] || '';
};

const findDetailImages = (files: fs.Dirent[]) => files
  .filter((file) => file.isFile() && /^0\d+\.(?:jpe?g|png|webp)$/i.test(file.name))
  .filter((file) => Number(file.name.match(/^(\d+)/)?.[1] || 0) >= 1)
  .map((file) => file.name)
  .sort((left, right) => {
    const leftNumber = Number(left.match(/^(\d+)/)?.[1] || 0);
    const rightNumber = Number(right.match(/^(\d+)/)?.[1] || 0);
    return leftNumber - rightNumber || left.localeCompare(right);
  });

export const resolveProductFolderRoot = (value: string) => {
  const directory = path.resolve(cleanInputPath(value));
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new BadRequestException(`产品资料文件夹不存在：${directory}`);
  }
  return directory;
};

export const scanProductFolders = (sourceDirectory: string, parameterType: FolderParameterType = 'auto'): ProductFolderCandidate[] => {
  const root = resolveProductFolderRoot(sourceDirectory);
  const pending = [root];
  const candidates: ProductFolderCandidate[] = [];
  let scannedDirectories = 0;

  while (pending.length) {
    const directory = pending.shift();
    if (!directory) break;
    scannedDirectories += 1;
    if (scannedDirectories > MAX_SCANNED_DIRECTORIES) {
      throw new BadRequestException(`文件夹数量超过 ${MAX_SCANNED_DIRECTORIES} 个，请缩小导入范围。`);
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .forEach((entry) => pending.push(path.join(directory, entry.name)));

    const modelName = path.basename(directory).trim();
    if (directory === root && !entries.some((entry) => entry.isFile() && /\.(?:txt|html?)$/i.test(entry.name) && matchesProductModel(entry.name, modelName))) continue;
    const existingThumbnail = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === '0.jpg')?.name || '';
    const thumbnailSourceFile = existingThumbnail ? '' : findNumberedImage(entries, '1');
    const thumbnailImageFile = existingThumbnail || (thumbnailSourceFile ? '0.jpg' : findNumberedImage(entries, '0'));
    const largeImageFile = findNumberedImage(entries, '00');
    const carouselImageFiles = ['1', '2', '3', '4']
      .map((number) => findNumberedImage(entries, number))
      .filter(Boolean);
    const detailHtmlFile = findDetailHtml(entries, modelName);
    const detailImageFiles = findDetailImages(entries);
    if (!thumbnailImageFile && !largeImageFile && !carouselImageFiles.length && !detailHtmlFile && !detailImageFiles.length) continue;

    const warnings: string[] = [];
    if (!largeImageFile) warnings.push('缺少 00.jpg 主图');
    if (!carouselImageFiles.length) warnings.push('缺少 1.jpg 至 4.jpg 轮播图');
    if (!detailHtmlFile) warnings.push('缺少型号对应的 HTML 详情文件');
    if (!detailImageFiles.length) warnings.push('没有 01.jpg 起的详情图片');
    const parameters = readFolderParameters(directory, entries, modelName, parameterType);
    warnings.push(...parameters.warnings);
    candidates.push({
      modelName,
      directory,
      relativePath: path.relative(root, directory) || modelName,
      thumbnailImageFile,
      thumbnailSourceFile,
      largeImageFile,
      carouselImageFiles,
      detailHtmlFile,
      detailImageFiles,
      warnings,
      parameters,
    });
    if (candidates.length > MAX_PRODUCT_FOLDERS) {
      throw new BadRequestException(`产品型号文件夹超过 ${MAX_PRODUCT_FOLDERS} 个，请分批导入。`);
    }
  }

  return candidates;
};

const escapeAttribute = (value: string) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const extractBodyContent = (html: string) => {
  const withoutBom = String(html || '').replace(/^\uFEFF/, '');
  const body = withoutBom.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] || withoutBom;
  return body
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .trim();
};

const shuffledHeadingIndexes = (count: number) => {
  const indexes = Array.from({ length: count }, (_value, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[target]] = [indexes[target], indexes[index]];
  }
  return indexes;
};

export const buildImportedProductContent = (html: string, modelName: string, imageUrls: string[]) => {
  let content = extractBodyContent(html);
  const images = imageUrls.map((src, index) => (
    `<p class="product-detail-image"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(modelName)} 详情图 ${index + 1}" loading="lazy"></p>`
  ));
  if (!images.length) return content;

  const headings = content.match(/<h[1-6]\b[^>]*>/gi) || [];
  if (!headings.length) return `${content}\n${images.join('\n')}`.trim();
  const order = shuffledHeadingIndexes(headings.length);
  // Randomize the slots, then assign images in document order (including overflow).
  const positions = images.map((_image, index) => order[index % order.length])
    .sort((left, right) => left - right);
  const inserts = new Map<number, string[]>();
  images.forEach((image, index) => {
    const headingIndex = positions[index];
    inserts.set(headingIndex, [...(inserts.get(headingIndex) || []), image]);
  });

  let headingIndex = 0;
  content = content.replace(/<h[1-6]\b[^>]*>/gi, (heading) => {
    const before = inserts.get(headingIndex)?.join('\n') || '';
    headingIndex += 1;
    return before ? `${before}\n${heading}` : heading;
  });
  return content;
};

export const readDetailHtml = (candidate: ProductFolderCandidate) => {
  if (!candidate.detailHtmlFile) return '';
  const filePath = path.join(candidate.directory, candidate.detailHtmlFile);
  const size = fs.statSync(filePath).size;
  if (size > MAX_DETAIL_HTML_BYTES) {
    throw new BadRequestException(`${candidate.relativePath} 的详情 HTML 超过 10MB。`);
  }
  return fs.readFileSync(filePath, 'utf8');
};

export const safeProductAssetSegment = (value: string) => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'product';
};
