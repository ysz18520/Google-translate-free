const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.translation.groupBy({
    by: ['targetLang', 'resourceType'],
    _count: { id: true }
  });
  console.log('Translation counts by language and type:');
  for (const row of counts) {
    console.log(`  ${row.targetLang} / ${row.resourceType}: ${row._count.id}`);
  }

  // Check Chinese theme translations
  const zhTheme = await prisma.translation.findMany({
    where: { targetLang: 'zh', resourceType: 'theme' },
    take: 5,
    select: { sourceText: true, translatedText: true }
  });
  console.log('\nChinese theme translations (sample):');
  for (const t of zhTheme) {
    console.log(`  "${t.sourceText}" -> "${t.translatedText}"`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
