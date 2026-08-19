import { Controller, Get, Post } from '@nestjs/common';
import { DatabaseBackupService } from './database-backup.service';

@Controller('database-backups')
export class DatabaseBackupController {
  constructor(private readonly databaseBackupService: DatabaseBackupService) {}

  @Get('current')
  getCurrentDatabaseInfo() {
    return this.databaseBackupService.getCurrentDatabaseInfo();
  }

  @Get()
  listBackups() {
    return this.databaseBackupService.listBackups();
  }

  @Post()
  createBackup() {
    return this.databaseBackupService.createBackup();
  }
}
