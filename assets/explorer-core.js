export const AXIS_IDS = [
  "draftSource",
  "draftGeometry",
  "verificationFidelity",
  "runtimeExecution",
];

export const MAX_COMPARE = 4;

export function recordIdFromHash(hash, records) {
  if (!hash.startsWith("#paper-")) return null;
  try {
    const id = decodeURIComponent(hash.slice("#paper-".length));
    return records.some((record) => record.id === id) ? id : null;
  } catch {
    return null;
  }
}

export const AXIS_QUERY_PARAMS = {
  draftSource: "source",
  draftGeometry: "geometry",
  verificationFidelity: "verification",
  runtimeExecution: "runtime",
};

export const AXIS_CSV_FIELDS = {
  draftSource: "draft_source",
  draftGeometry: "draft_geometry",
  verificationFidelity: "verification_fidelity",
  runtimeExecution: "runtime_execution",
};

export const CSV_FIELDS = [
  "date",
  "short_name",
  "title",
  "draft_source",
  "draft_geometry",
  "verification_fidelity",
  "runtime_execution",
  "paper_url",
  "github_url",
  "project_urls",
];

const VALID_STATUS = new Set(["all", "core", "inherited"]);
const VALID_MATCH_MODES = new Set(["any", "all"]);
const VALID_SORT = new Set(["date-desc", "date-asc", "name-asc", "name-desc"]);
const VALID_PAGE_SIZES = new Set(["25", "50", "all"]);
const VALID_RESOURCES = new Set(["code", "project"]);

// Preserve shared links created before the Runtime taxonomy was renamed.
// Parsed state always stores the current slug, so serialization upgrades the
// URL automatically and no legacy slug leaks into newly shared links.
export const LEGACY_RUNTIME_SLUGS = Object.freeze({
  "execution-state-consistency": "state-management",
  "scheduling-and-speculation-budgeting": "speculation-control",
  "serving-systems-and-implementation": "serving-systems",
  "benchmarking-and-cost-analysis": "performance-analysis",
});

export function createDefaultState() {
  return {
    years: new Set(),
    axes: Object.fromEntries(AXIS_IDS.map((axisId) => [axisId, new Set()])),
    status: "all",
    matchMode: "any",
    resources: new Set(),
    query: "",
    sort: "date-desc",
    page: 1,
    pageSize: "25",
    compare: new Set(),
  };
}

export function cloneState(state) {
  return {
    years: new Set(state.years),
    axes: Object.fromEntries(
      AXIS_IDS.map((axisId) => [axisId, new Set(state.axes[axisId])]),
    ),
    status: state.status,
    matchMode: state.matchMode,
    resources: new Set(state.resources),
    query: state.query,
    sort: state.sort,
    page: state.page,
    pageSize: state.pageSize,
    compare: new Set(state.compare),
  };
}

function taxonomyIndex(dataset) {
  const axes = new Map();
  for (const axis of dataset.taxonomy.axes) {
    axes.set(axis.id, {
      axis,
      values: new Set(axis.leaves.map((leaf) => leaf.id)),
    });
  }
  return axes;
}

export function parseState(search, dataset) {
  const state = createDefaultState();
  const warnings = [];
  const params = new URLSearchParams(search);
  const validYears = new Set(dataset.source.years.map(String));
  const taxonomy = taxonomyIndex(dataset);
  const recordIds = new Set(dataset.records.map((record) => record.id));

  for (const value of params.getAll("year")) {
    if (validYears.has(value)) state.years.add(Number(value));
    else warnings.push(`Ignored unknown year: ${value}`);
  }

  for (const axisId of AXIS_IDS) {
    const queryParam = AXIS_QUERY_PARAMS[axisId];
    const validValues = taxonomy.get(axisId)?.values ?? new Set();
    for (const rawValue of params.getAll(queryParam)) {
      const value =
        axisId === "runtimeExecution"
          ? (LEGACY_RUNTIME_SLUGS[rawValue] ?? rawValue)
          : rawValue;
      if (value === "unclassified" || validValues.has(value)) {
        state.axes[axisId].add(value);
      } else {
        warnings.push(`Ignored unknown ${queryParam} value: ${rawValue}`);
      }
    }
  }

  const status = params.get("status");
  if (status && VALID_STATUS.has(status)) state.status = status;
  else if (status) warnings.push(`Ignored unknown status: ${status}`);

  const matchMode = params.get("match");
  if (matchMode && VALID_MATCH_MODES.has(matchMode)) state.matchMode = matchMode;
  else if (matchMode) warnings.push(`Ignored unknown match mode: ${matchMode}`);

  for (const value of params.getAll("resource")) {
    if (VALID_RESOURCES.has(value)) state.resources.add(value);
    else warnings.push(`Ignored unknown resource filter: ${value}`);
  }

  const query = params.get("q");
  if (query) state.query = query.trim().slice(0, 200);

  const sort = params.get("sort");
  if (sort && VALID_SORT.has(sort)) state.sort = sort;
  else if (sort) warnings.push(`Ignored unknown sort: ${sort}`);

  const pageSize = params.get("limit");
  if (pageSize && VALID_PAGE_SIZES.has(pageSize)) state.pageSize = pageSize;
  else if (pageSize) warnings.push(`Ignored unknown page size: ${pageSize}`);

  const page = Number.parseInt(params.get("page") ?? "1", 10);
  if (Number.isFinite(page) && page > 0) state.page = page;

  for (const value of params.getAll("compare")) {
    if (recordIds.has(value) && state.compare.size < MAX_COMPARE) {
      state.compare.add(value);
    }
    else if (!recordIds.has(value)) warnings.push(`Ignored unknown work ID: ${value}`);
  }

  return { state, warnings };
}

export function serializeState(state) {
  const params = new URLSearchParams();
  [...state.years]
    .sort((a, b) => b - a)
    .forEach((year) => params.append("year", String(year)));

  for (const axisId of AXIS_IDS) {
    [...state.axes[axisId]]
      .sort()
      .forEach((value) => params.append(AXIS_QUERY_PARAMS[axisId], value));
  }

  if (state.status !== "all") params.set("status", state.status);
  if (state.matchMode !== "any") params.set("match", state.matchMode);
  [...state.resources]
    .sort()
    .forEach((resource) => params.append("resource", resource));
  if (state.query) params.set("q", state.query);
  if (state.sort !== "date-desc") params.set("sort", state.sort);
  if (state.pageSize !== "25") params.set("limit", state.pageSize);
  if (state.page > 1) params.set("page", String(state.page));
  [...state.compare]
    .sort()
    .forEach((recordId) => params.append("compare", recordId));
  return params.toString();
}

function normalizedSearchText(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function hasSelectedAxisValues(state) {
  return AXIS_IDS.some((axisId) => state.axes[axisId].size > 0);
}

export function recordMatches(record, state, ignoredFacet = null) {
  if (
    ignoredFacet !== "year" &&
    state.years.size > 0 &&
    !state.years.has(record.year)
  ) {
    return false;
  }

  for (const axisId of AXIS_IDS) {
    if (ignoredFacet === axisId) continue;
    const selected = state.axes[axisId];
    if (selected.size === 0) continue;
    const assignments = record.axes[axisId];
    const matchesUnclassified =
      selected.has("unclassified") && assignments.length === 0;
    const selectedLeaves = [...selected].filter((value) => value !== "unclassified");
    const assignmentMatches = (value) =>
      assignments.some(
        (assignment) =>
          assignment.value === value &&
          (state.status === "all" || assignment.type === state.status),
      );
    const matchesAssignment =
      state.matchMode === "all"
        ? selectedLeaves.length > 0 && selectedLeaves.every(assignmentMatches)
        : selectedLeaves.some(assignmentMatches);
    const matchesAxis =
      state.matchMode === "all" && selected.has("unclassified") && selectedLeaves.length
        ? false
        : matchesUnclassified || matchesAssignment;
    if (!matchesAxis) return false;
  }

  if (
    ignoredFacet !== "resource:code" &&
    state.resources.has("code") &&
    record.links.code.length === 0
  ) {
    return false;
  }
  if (
    ignoredFacet !== "resource:project" &&
    state.resources.has("project") &&
    record.links.project.length === 0
  ) {
    return false;
  }

  if (state.query) {
    const query = normalizedSearchText(state.query);
    const haystack = normalizedSearchText(
      `${record.shortName} ${record.title} ${record.citekey}`,
    );
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function filterRecords(records, state, ignoredFacet = null) {
  return records.filter((record) => recordMatches(record, state, ignoredFacet));
}

export function sortRecords(records, sort) {
  const sorted = [...records];
  const byName = (left, right) =>
    left.shortName.localeCompare(right.shortName, "en", {
      sensitivity: "base",
      numeric: true,
    });
  sorted.sort((left, right) => {
    if (sort === "name-asc") return byName(left, right);
    if (sort === "name-desc") return byName(right, left);
    const dateOrder = left.date.localeCompare(right.date);
    if (dateOrder !== 0) return sort === "date-asc" ? dateOrder : -dateOrder;
    return byName(left, right);
  });
  return sorted;
}

export function applyState(records, state) {
  return sortRecords(filterRecords(records, state), state.sort);
}

export function facetCounts(dataset, state) {
  const result = {
    years: new Map(),
    axes: Object.fromEntries(AXIS_IDS.map((axisId) => [axisId, new Map()])),
    resources: new Map(),
  };

  const yearBase = filterRecords(dataset.records, state, "year");
  for (const year of dataset.source.years) {
    result.years.set(
      year,
      yearBase.reduce((count, record) => count + Number(record.year === year), 0),
    );
  }

  for (const axisId of AXIS_IDS) {
    const axisBase = filterRecords(dataset.records, state, axisId);
    const axis = dataset.taxonomy.axes.find((item) => item.id === axisId);
    for (const leaf of axis.leaves) {
      const count = axisBase.reduce(
        (total, record) =>
          total +
          Number(
            record.axes[axisId].some(
              (assignment) =>
                assignment.value === leaf.id &&
                (state.status === "all" || assignment.type === state.status),
            ),
          ),
        0,
      );
      result.axes[axisId].set(leaf.id, count);
    }
    result.axes[axisId].set(
      "unclassified",
      axisBase.reduce(
        (total, record) => total + Number(record.axes[axisId].length === 0),
        0,
      ),
    );
  }

  for (const resource of ["code", "project"]) {
    const resourceBase = filterRecords(
      dataset.records,
      state,
      `resource:${resource}`,
    );
    result.resources.set(
      resource,
      resourceBase.reduce(
        (total, record) =>
          total + Number(record.links[resource].length > 0),
        0,
      ),
    );
  }
  return result;
}

export function selectedFilterCount(state) {
  return (
    state.years.size +
    AXIS_IDS.reduce((count, axisId) => count + state.axes[axisId].size, 0) +
    state.resources.size +
    Number(Boolean(state.query)) +
    Number(state.status !== "all") +
    Number(state.matchMode !== "any")
  );
}

export function paginateRecords(records, state) {
  if (state.pageSize === "all") {
    return { records, page: 1, pageCount: 1, start: records.length ? 1 : 0, end: records.length };
  }
  const size = Number(state.pageSize);
  const pageCount = Math.max(1, Math.ceil(records.length / size));
  const page = Math.min(Math.max(1, state.page), pageCount);
  const offset = (page - 1) * size;
  return {
    records: records.slice(offset, offset + size),
    page,
    pageCount,
    start: records.length ? offset + 1 : 0,
    end: Math.min(offset + size, records.length),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function axisToCsv(assignments) {
  if (!assignments.length) return "--";
  return assignments
    .map((assignment) => `${assignment.label} [${assignment.type}]`)
    .join("; ");
}

export function recordsToCsv(records) {
  const rows = [CSV_FIELDS];
  for (const record of records) {
    rows.push([
      record.date,
      record.shortName,
      record.title,
      axisToCsv(record.axes.draftSource),
      axisToCsv(record.axes.draftGeometry),
      axisToCsv(record.axes.verificationFidelity),
      axisToCsv(record.axes.runtimeExecution),
      record.links.paper.join("; "),
      record.links.code.join("; "),
      record.links.project.join("; "),
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function exportFileName(state, count) {
  const parts = ["speculative-decoding-method-profiles"];
  if (state.years.size === 1) parts.push(String([...state.years][0]));
  const selectedLeaves = AXIS_IDS.flatMap((axisId) => [...state.axes[axisId]]);
  if (selectedLeaves.length === 1) parts.push(selectedLeaves[0]);
  if (state.status !== "all") parts.push(state.status);
  parts.push(String(count));
  return `${parts.join("_")}.csv`;
}

function mechanismSet(record) {
  return new Set(
    AXIS_IDS.flatMap((axisId) =>
      record.axes[axisId].map((assignment) => `${axisId}:${assignment.value}`),
    ),
  );
}

export function mechanismNeighbors(record, records, limit = 5) {
  const source = mechanismSet(record);
  return records
    .filter((candidate) => candidate.id !== record.id)
    .map((candidate) => {
      const target = mechanismSet(candidate);
      const shared = [...source].filter((value) => target.has(value));
      const unionSize = new Set([...source, ...target]).size;
      return {
        record: candidate,
        sharedCount: shared.length,
        score: unionSize ? shared.length / unionSize : 0,
      };
    })
    .filter((item) => item.sharedCount > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.sharedCount - left.sharedCount ||
        right.record.date.localeCompare(left.record.date) ||
        left.record.shortName.localeCompare(right.record.shortName),
    )
    .slice(0, limit);
}
