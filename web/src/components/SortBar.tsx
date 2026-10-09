import type { SortField, SortOrder } from "../api/types";
import { IconSortAsc, IconSortDesc } from "./Icons";

const LABELS: Record<SortField, string> = {
  title: "Title",
  added: "Date added",
  modified: "Date modified",
  size: "File size",
  duration: "Duration",
};

interface Props {
  sort: SortField;
  order: SortOrder;
  onChange: (sort: SortField, order: SortOrder) => void;
  fields?: SortField[];
}

export function SortBar({ sort, order, onChange, fields = ["title", "added", "modified", "size", "duration"] }: Props) {
  return (
    <div className="sortbar">
      <label className="select">
        <span className="sr-only">Sort by</span>
        <select value={sort} onChange={(e) => onChange(e.target.value as SortField, order)}>
          {fields.map((f) => (
            <option key={f} value={f}>
              {LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-btn bordered"
        onClick={() => onChange(sort, order === "asc" ? "desc" : "asc")}
        aria-label={order === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"}
        title={order === "asc" ? "Ascending" : "Descending"}
      >
        {order === "asc" ? <IconSortAsc size={18} /> : <IconSortDesc size={18} />}
      </button>
    </div>
  );
}

/** Sort state persisted in the URL search params so back/forward keeps it. */
export function readSort(sp: URLSearchParams, defSort: SortField, defOrder: SortOrder): { sort: SortField; order: SortOrder } {
  const s = sp.get("sort");
  const o = sp.get("order");
  const sort = s && s in LABELS ? (s as SortField) : defSort;
  const order = o === "asc" || o === "desc" ? o : defOrder;
  return { sort, order };
}
