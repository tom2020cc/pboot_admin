import { Global, Module } from '@nestjs/common';
import { SyncGuardService } from './sync-guard.service';

@Global()
@Module({
  providers: [SyncGuardService],
  exports: [SyncGuardService],
})
export class SyncGuardModule {}
