/**
 * Seed script — bootstraps a Platform clinic + super_admin user from env.
 *
 * Reads:
 *   SUPER_ADMIN_EMAIL    (required)
 *   SUPER_ADMIN_PASSWORD (required)
 *
 * Run: npm run db:seed   (from apps/api)
 *
 * Idempotent — safe to re-run. Updates password if user already exists.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const prisma = new PrismaClient();

const PLATFORM_SLUG = 'platform';
const PLATFORM_NAME = 'DentalEase Platform';

async function main() {
  const email    = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌  SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  // 1. Platform clinic (single host for super admin)
  let clinic = await prisma.clinic.findUnique({ where: { slug: PLATFORM_SLUG } });
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        slug:        PLATFORM_SLUG,
        name:        PLATFORM_NAME,
        ownerName:   'Platform Owner',
        email,
        plan:        'enterprise' as any,
        subStatus:   'active'     as any,
      },
    });
    console.log(`✅  Created platform clinic (id=${clinic.id})`);
  } else {
    console.log(`✓  Platform clinic exists (id=${clinic.id})`);
  }

  // 2. Super admin user
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { email, clinicId: clinic.id } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data:  { passwordHash, role: 'super_admin' as any, isActive: true },
    });
    console.log(`✓  Super admin updated (${email})`);
  } else {
    await prisma.user.create({
      data: {
        clinicId:     clinic.id,
        fullName:     'Super Admin',
        email,
        passwordHash,
        role:         'super_admin' as any,
        isActive:     true,
      },
    });
    console.log(`✅  Super admin created (${email})`);
  }

  console.log('\n🎉  Seed complete. Login with:');
  console.log(`   email:    ${email}`);
  console.log(`   password: (from SUPER_ADMIN_PASSWORD)\n`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
