import { Module } from '@nestjs/common';
import { PrescriptionsController, PrescriptionTemplatesController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';
import { PdfService } from './pdf.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PrescriptionsController, PrescriptionTemplatesController],
  providers: [PrescriptionsService, PdfService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
