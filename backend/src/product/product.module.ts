import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductTranslation } from './entities/product-translation.entity';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { Menu } from '../menu/entities/menu.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductTranslation, Menu])],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
