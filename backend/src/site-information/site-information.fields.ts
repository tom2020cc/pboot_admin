import { BadRequestException } from '@nestjs/common';
import { domainHost } from '../common/pboot-domain-link';

export type InformationSection = 'site' | 'company';
export type InformationData = { site: Record<string, string>; company: Record<string, string> };
export const INFORMATION_FIELDS = [
  { section: 'site', key: 'title', label: '站点标题', translate: true, maxLength: 300 },
  { section: 'site', key: 'subtitle', label: '站点副标题', translate: true, maxLength: 1000 },
  { section: 'site', key: 'domain', label: '站点域名', maxLength: 2048 },
  { section: 'site', key: 'logo', label: '站点 Logo', type: 'image', maxLength: 2048 },
  { section: 'site', key: 'keywords', label: '站点关键词', translate: true, maxLength: 2000 },
  { section: 'site', key: 'description', label: '站点描述', type: 'textarea', translate: true, maxLength: 10000 },
  { section: 'site', key: 'icp', label: '站点备案', maxLength: 300 },
  { section: 'site', key: 'theme', label: '站点模板', type: 'theme', maxLength: 100 },
  { section: 'site', key: 'statistical', label: '统计代码', type: 'textarea', maxLength: 20000 },
  { section: 'site', key: 'copyright', label: '尾部信息', type: 'textarea', translate: true, maxLength: 10000 },
  { section: 'company', key: 'name', label: '公司名称', translate: true, maxLength: 500 },
  { section: 'company', key: 'address', label: '公司地址', translate: true, maxLength: 1000 },
  { section: 'company', key: 'postcode', label: '邮政编码', maxLength: 50 },
  { section: 'company', key: 'contact', label: '联系人', translate: true, maxLength: 200 },
  { section: 'company', key: 'mobile', label: '手机号码', maxLength: 200 },
  { section: 'company', key: 'phone', label: '电话号码', maxLength: 200 },
  { section: 'company', key: 'fax', label: '传真号码', maxLength: 200 },
  { section: 'company', key: 'email', label: '电子邮箱', maxLength: 300 },
  { section: 'company', key: 'qq', label: 'QQ 号码', maxLength: 100 },
  { section: 'company', key: 'weixin', label: '微信二维码', type: 'image', maxLength: 2048 },
  { section: 'company', key: 'blicense', label: '营业执照代码', maxLength: 200 },
  { section: 'company', key: 'other', label: '其它信息', type: 'textarea', translate: true, maxLength: 10000 },
] as const;

export function normalizeInformation(input: unknown): InformationData {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('资料格式无效');
  const data: InformationData = { site: {}, company: {} };
  for (const section of ['site', 'company'] as const) {
    const values = input[section];
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new BadRequestException('请提交完整的站点和公司资料');
    const fields = INFORMATION_FIELDS.filter(field => field.section === section);
    if (Object.keys(values).some(key => !fields.some(field => field.key === key))) throw new BadRequestException('资料含有未知字段');
    for (const field of fields) {
      const value = values[field.key];
      if (typeof value !== 'string' || value.length > field.maxLength || value.includes('\0')) throw new BadRequestException(`${field.label}格式无效或超过长度限制`);
      data[section][field.key] = value;
    }
  }
  const theme = data.site.theme;
  domainHost(data.site.domain);
  if (theme && !/^[\p{L}\p{N}_-]+$/u.test(theme)) throw new BadRequestException('模板名称不能包含路径或特殊字符');
  for (const value of [data.site.logo, data.company.weixin]) {
    if (value && (/^(?:javascript|data|blob):/i.test(value.trim()) || /[<>"\r\n]/.test(value))) throw new BadRequestException('图片地址无效，请上传图片或填写 HTTP(S) 地址');
  }
  return data;
}

export function translationFields(data: InformationData) {
  return Object.fromEntries(INFORMATION_FIELDS.filter(field => 'translate' in field && field.translate)
    .map(field => [`${field.section}.${field.key}`, data[field.section][field.key]]));
}
