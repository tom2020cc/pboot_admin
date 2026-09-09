import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagedSite } from './entities/managed-site.entity';
import { SiteRequestContextMiddleware, SiteRequestContextService } from './site-request-context.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { SiteResourcesController } from './site-resources.controller';
import { SiteResourcesService } from './site-resources.service';
import { TemplateBindingsController } from './template-bindings.controller';
import { TemplateBindingsService } from './template-bindings.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ManagedSite])],
  controllers: [SitesController, SiteResourcesController, TemplateBindingsController],
  providers: [SitesService, SiteResourcesService, TemplateBindingsService, SiteRequestContextService, SiteRequestContextMiddleware],
  exports: [SitesService, SiteRequestContextService, SiteRequestContextMiddleware],
})
export class SitesModule {}
