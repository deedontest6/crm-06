import { cloneElement, isValidElement, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Table, TableBody } from "@/components/ui/table";

interface Props<T> {
  rowItems: T[];
  renderRow: (item: T, key: string | number) => ReactNode;
  header: ReactNode;
  estimateRowHeight?: number;
  maxHeight?: string;
}

/**
 * Virtualized wrapper around the audience table body. Keeps the same
 * semantic <table>/<tbody> structure (so columns line up with the header)
 * but only mounts the rows currently in (or near) the scroll viewport.
 *
 * Spacer <tr>s with computed heights at top and bottom preserve total
 * scroll height so the scrollbar feels right. Used only when the row count
 * crosses ~60 — small audiences keep the non-virtualized path.
 */
export function VirtualizedAudienceTable<T>({
  rowItems,
  renderRow,
  header,
  estimateRowHeight = 44,
  maxHeight = "70vh",
}: Props<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rowItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div
      ref={scrollRef}
      className="border rounded-lg overflow-auto"
      style={{ maxHeight }}
    >
      <Table className="min-w-[760px]">
        {header}
        <TableBody>
          {paddingTop > 0 && (
            <tr aria-hidden style={{ height: paddingTop }}>
              <td colSpan={100} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {virtualRows.map((vr) => {
            const item = rowItems[vr.index];
            const rendered = renderRow(item, vr.key as string | number);
            // Inject a ref so the virtualizer can measure each row's real
            // height (rows have variable heights — account banner is taller
            // than a contact row, badges can wrap, etc.).
            if (isValidElement(rendered)) {
              const existingRef = (rendered as any).ref;
              const composedRef = (node: HTMLElement | null) => {
                if (node) {
                  node.setAttribute("data-index", String(vr.index));
                  virtualizer.measureElement(node);
                }
                if (typeof existingRef === "function") existingRef(node);
                else if (existingRef && typeof existingRef === "object") existingRef.current = node;
              };
              return cloneElement(rendered as any, { ref: composedRef, key: vr.key });
            }
            return rendered;
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden style={{ height: paddingBottom }}>
              <td colSpan={100} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
