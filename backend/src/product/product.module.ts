import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductTranslation } from './entities/product-translation.entity';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { Menu } from '../menu/entities/menu.entity';
import { ProductFieldsController } from './product-fields.controller';
import { ProductFieldsService } from './product-fields.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductTranslation, Menu])],
  controllers: [ProductController, ProductFieldsController],
  providers: [ProductService, ProductFieldsService],
})
export class ProductModule {}
