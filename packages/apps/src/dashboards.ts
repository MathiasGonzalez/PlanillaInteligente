import { and, eq, sql } from 'drizzle-orm';
import { records } from '@planilla/cloudflare/d1/schema';
import type { DashboardWidget } from './spec';
import type { Database } from './db';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export interface WidgetPoint {
  label: string;
  value: number;
}

function jsonPath(fieldKey: string | null) {
  if (!fieldKey || !KEY.test(fieldKey)) return null;
  return `$.${fieldKey}`;
}

export async function aggregateWidget(db: Database, tenantId: string, appId: string, widget: DashboardWidget): Promise<WidgetPoint[]> {
  const where = and(eq(records.tenantId, tenantId), eq(records.appId, appId), eq(records.entityKey, widget.entityKey));
  const metricPath = jsonPath(widget.metric.fieldKey);
  const metric = widget.metric.op === 'count' || !metricPath
    ? sql<number>`count(*)`
    : widget.metric.op === 'avg'
      ? sql<number>`avg(cast(json_extract(${records.data}, ${metricPath}) as real))`
      : sql<number>`sum(cast(json_extract(${records.data}, ${metricPath}) as real))`;
  const groupPath = jsonPath(widget.groupBy);
  if (!groupPath && widget.type === 'kpi') {
    const [row] = await db.select({ value: metric }).from(records).where(where);
    return [{ label: widget.title, value: Number(row?.value ?? 0) }];
  }
  const bucket = widget.dateBucket === 'month' && groupPath
    ? sql<string>`substr(json_extract(${records.data}, ${groupPath}), 1, 7)`
    : groupPath
      ? sql<string>`json_extract(${records.data}, ${groupPath})`
      : sql<string>`''`;
  const rows = await db.select({ label: bucket, value: metric }).from(records).where(where).groupBy(bucket).limit(24);
  return rows.map((row) => ({ label: String(row.label ?? '—'), value: Number(row.value ?? 0) }));
}
