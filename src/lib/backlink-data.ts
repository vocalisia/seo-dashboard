export interface BacklinkRow {
  linking_domain: string;
  target_page: string;
  link_count: number;
}

/** Legacy GSC visibility rows are not backlinks and must never feed backlink KPIs. */
export function isVerifiedBacklinkRow(row: BacklinkRow): boolean {
  return Boolean(row.linking_domain)
    && row.linking_domain.toLowerCase() !== "gsc visibility signal"
    && Number(row.link_count) > 0;
}
