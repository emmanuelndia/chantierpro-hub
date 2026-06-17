import { buildPlanningImportTemplate } from '@/lib/planning-import';

export async function GET() {
  const buffer = await buildPlanningImportTemplate();
  return new Response(buffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="modele-import-planning.xlsx"',
      'cache-control': 'no-store',
    },
  });
}
