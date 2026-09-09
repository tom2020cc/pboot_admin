import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_GUARD } from '@nestjs/core';
import request = require('supertest');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImgUploadController } from './img-upload.controller';
import { ImgUploadService } from './img-upload.service';
import { SitesService } from '../sites/sites.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SiteRequestContextMiddleware, SiteRequestContextService } from '../sites/site-request-context.service';

const secret = 'upload-endpoint-test-only';
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }); }
  validate(payload: any) { return payload; }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA6sAAAAASUVORK5CYII=', 'base64');

describe('uploaded images with site context and JWT protection', () => {
  let app: INestApplication;
  let directory: string;
  let token: string;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uploaded-image-http-'));
    const context = new SiteRequestContextService();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })], controllers: [ImgUploadController],
      providers: [ImgUploadService, TestJwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }, {
        provide: SitesService, useValue: {
          getCurrentSiteId: () => context.getSiteId() || 2,
          getCurrentSiteStorageDir: () => path.join(directory, String(context.getSiteId() || 2)),
          isDefaultSite: () => false,
        },
      }],
    }).compile();
    app = module.createNestApplication();
    app.use((req, res, next) => new SiteRequestContextMiddleware(context).use(req, res, next));
    await app.init();
    token = module.get(JwtService).sign({ sub: 1, email: 'test@example.invalid' });
  });
  afterAll(async () => {
    await app?.close();
    if (path.resolve(directory).startsWith(path.join(os.tmpdir(), 'uploaded-image-http-'))) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps single and multiple image uploads protected', async () => {
    await request(app.getHttpServer()).post('/img-upload/img').attach('aaa', png, 'test.png').expect(401);
    await request(app.getHttpServer()).post('/img-upload/imgs').attach('imgArr', png, 'test.png').expect(401);
  });

  it('uploads media for the selected site, then displays it without an Authorization header', async () => {
    const uploaded = await request(app.getHttpServer()).post('/img-upload/imgs')
      .set('Authorization', `Bearer ${token}`).set('X-Pboot-Site-Id', '2')
      .attach('imgArr', png, 'thumbnail.png').attach('imgArr', png, 'large.png').attach('imgArr', png, 'carousel.png').expect(201);
    expect(uploaded.body).toHaveLength(3);
    for (const name of uploaded.body) {
      const image = await request(app.getHttpServer()).get(`/img-upload/file/${name}?siteId=2`).expect(200).expect('Content-Type', /image\/png/);
      expect(image.body).toEqual(png);
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      await request(app.getHttpServer()).get(`/img-upload/file/${name}?siteId=3`).expect(400);
      await request(app.getHttpServer()).get(`/img-upload/file/${name}?siteId=2`).expect(200);
    }
  });

  it('supports the single-file route used by other upload controls', async () => {
    const uploaded = await request(app.getHttpServer()).post('/img-upload/img?siteId=3')
      .set('Authorization', `Bearer ${token}`).attach('aaa', png, 'content.png').expect(201);
    await request(app.getHttpServer()).get(`/img-upload/file/${uploaded.text}?siteId=3`).expect(200);
  });

  it('does not expose non-images or accept traversal/Windows alternate streams', async () => {
    fs.mkdirSync(path.join(directory, '2/uploads'), { recursive: true });
    fs.writeFileSync(path.join(directory, '2/uploads/private.txt'), 'private');
    for (const name of ['private.txt', '..%5cprivate.png', 'a.png%3Aprivate', '%00.png']) {
      await request(app.getHttpServer()).get(`/img-upload/file/${name}?siteId=2`).expect(400);
    }
  });
});
