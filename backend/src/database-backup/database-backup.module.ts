import { Module } from '@nestjs/common';
import { DatabaseBackupController } from './database-backup.controller';
import { DatabaseBackupService } from './database-backup.service';

@Module({
  controllers: [DatabaseBackupController],
  providers: [DatabaseBackupService],
})
export class DatabaseBackupModule {}
