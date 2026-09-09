import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction, Request, Response } from 'express';

type SiteRequestState = { siteId?: number };

@Injectable()
export class SiteRequestContextService {
  private readonly storage = new AsyncLocalStorage<SiteRequestState>();

  run(siteId: number | undefined, callback: () => void) {
    this.storage.run({ siteId }, callback);
  }

  getSiteId() {
    return this.storage.getStore()?.siteId;
  }
}

@Injectable()
export class SiteRequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: SiteRequestContextService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const querySiteId = Array.isArray(req.query?.siteId) ? req.query.siteId[0] : req.query?.siteId;
    const raw = req.header('x-pboot-site-id') || String(querySiteId || '');
    const parsed = raw ? Number(raw) : NaN;
    this.context.run(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined, next);
  }
}
