import {
  AXIS_IDS,
  MAX_COMPARE,
  applyState,
  cloneState,
  createDefaultState,
  exportFileName,
  facetCounts,
  mechanismNeighbors,
  paginateRecords,
  parseState,
  recordsToCsv,
  selectedFilterCount,
  serializeState,
} from "./explorer-core.js";

const FIELD_TO_AXIS = {
  draft_source: "draftSource",
  draft_geometry: "draftGeometry",
  verification_fidelity: "verificationFidelity",
  runtime_execution: "runtimeExecution",
};

const body = document.body;
const dataSource = body.dataset.matrixSource || "data/coding_matrix.json";
const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];

let dataset;
let state = createDefaultState();
let pendingMobileState = null;
let filteredRecords = [];
let currentDetailId = null;
let searchTimer = null;
let filterGroupsHome = null;
let filterGroupsNextSibling = null;

const elements = {
  searchForm: byId("matrix-search-form"),
  search: byId("matrix-search"),
  searchClear: byId("search-clear"),
  filterForm: byId("filter-form"),
  filterGroups: byId("filter-groups"),
  mobileFilterDialog: byId("mobile-filter-dialog"),
  mobileFilterMount: document.querySelector("[data-mobile-filter-mount]"),
  sort: byId("sort-select"),
  pageSize: byId("page-size-select"),
  count: byId("visible-result-count"),
  countLabel: byId("result-count-label"),
  querySummary: byId("query-summary"),
  activeRegion: byId("active-filter-region"),
  activeList: byId("active-filter-list"),
  status: byId("matrix-status"),
  resultsSurface: byId("results-surface"),
  tableBody: byId("results-table-body"),
  cardList: byId("results-card-list"),
  noResults: byId("no-results"),
  error: byId("matrix-error"),
  pagination: byId("results-pagination"),
  paginationSummary: byId("pagination-summary"),
  previousPage: byId("previous-page"),
  nextPage: byId("next-page"),
  mobileFilterCount: byId("mobile-filter-count"),
  mobileApplyCount: byId("mobile-apply-result-count"),
  compareTray: byId("compare-tray"),
  compareCount: byId("compare-selection-count"),
  compareList: byId("compare-selection-list"),
  compareOpen: byId("open-compare-dialog"),
  detailDialog: byId("detail-dialog"),
  detailCompare: byId("detail-compare-toggle"),
  compareDialog: byId("compare-dialog"),
  compareHead: byId("compare-table-head"),
  compareBody: byId("compare-table-body"),
  yearLandscape: byId("landscape-years"),
  axisLandscape: byId("landscape-axes"),
  toast: byId("explorer-toast"),
};

function axisMeta(axisId) {
  return dataset.taxonomy.axes.find((axis) => axis.id === axisId);
}

function leafMeta(axisId, leafId) {
  return axisMeta(axisId)?.leaves.find((leaf) => leaf.id === leafId);
}

function normalizeAxisId(value) {
  if (AXIS_IDS.includes(value)) return value;
  return FIELD_TO_AXIS[value] ?? null;
}

function leafIdFromControl(input) {
  if (input.dataset.leaf) return input.dataset.leaf;
  if (input.value === "--") return "unclassified";
  return input.value;
}

function freshFilterState(previous = state) {
  const fresh = createDefaultState();
  fresh.sort = previous.sort;
  fresh.pageSize = previous.pageSize;
  fresh.compare = new Set(previous.compare);
  return fresh;
}

function currentWorkingState() {
  return pendingMobileState ?? state;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message) {
  if (elements.toast) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2400);
  } else {
    elements.status.textContent = message;
    elements.status.hidden = false;
    window.setTimeout(() => {
      elements.status.hidden = true;
    }, 1800);
  }
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(successMessage);
}

function stateUrl({ hash = window.location.hash } = {}) {
  const query = serializeState(state);
  return `${window.location.pathname}${query ? `?${query}` : ""}${hash || ""}`;
}

function writeHistory(mode = "push", options = {}) {
  const url = stateUrl(options);
  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method](null, "", url);
}

function downloadText(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateCorpusMeta() {
  byId("hero-work-count").textContent = String(dataset.source.recordCount);
  const fromYear = dataset.source.dateRange.from.slice(0, 4);
  const throughYear = dataset.source.dateRange.through.slice(0, 4);
  byId("hero-date-range").textContent = `${fromYear}–${throughYear}`;
  document.title = `Speculative Decoding Method Profiles · ${dataset.source.recordCount} works`;
}

function syncControls(targetState = currentWorkingState()) {
  all('[data-filter-key="year"]').forEach((input) => {
    input.checked = targetState.years.has(Number(input.value));
  });

  all("[data-filter-axis]").forEach((input) => {
    const axisId = normalizeAxisId(input.dataset.filterAxis);
    const leafId = leafIdFromControl(input);
    input.checked = Boolean(
      axisId && leafId && targetState.axes[axisId].has(leafId),
    );
  });

  all('input[name="status"]').forEach((input) => {
    input.checked = input.value === targetState.status;
  });
  all('input[name="match"]').forEach((input) => {
    input.checked = input.value === targetState.matchMode;
  });
  all('[data-filter-key="resource"]').forEach((input) => {
    input.checked = targetState.resources.has(input.value);
  });

  elements.search.value = targetState.query;
  elements.searchClear.hidden = !targetState.query;
  elements.sort.value = targetState.sort;
  elements.pageSize.value = targetState.pageSize;

  const leafSelectionCount = AXIS_IDS.reduce(
    (count, axisId) =>
      count +
      [...targetState.axes[axisId]].filter((value) => value !== "unclassified").length,
    0,
  );
  all('input[name="status"]').forEach((input) => {
    input.disabled = leafSelectionCount === 0;
  });
  all('input[name="match"]').forEach((input) => {
    input.disabled = !AXIS_IDS.some((axisId) => targetState.axes[axisId].size > 1);
  });
}

function updateStateFromControl(input, targetState) {
  if (input.dataset.filterKey === "year") {
    const year = Number(input.value);
    input.checked ? targetState.years.add(year) : targetState.years.delete(year);
  } else if (input.dataset.filterAxis) {
    const axisId = normalizeAxisId(input.dataset.filterAxis);
    const leafId = leafIdFromControl(input);
    if (!axisId || !leafId) return;
    input.checked
      ? targetState.axes[axisId].add(leafId)
      : targetState.axes[axisId].delete(leafId);
  } else if (input.dataset.filterKey === "status") {
    targetState.status = input.value;
  } else if (input.dataset.filterKey === "match") {
    targetState.matchMode = input.value;
  } else if (input.dataset.filterKey === "resource") {
    input.checked
      ? targetState.resources.add(input.value)
      : targetState.resources.delete(input.value);
  }
  targetState.page = 1;
}

function renderFacetCounts(targetState = currentWorkingState()) {
  const counts = facetCounts(dataset, targetState);
  all("[data-facet-count]").forEach((element) => {
    const [field, label] = element.dataset.facetCount.split(":");
    let value = 0;
    if (field === "year") {
      value = counts.years.get(Number(label)) ?? 0;
    } else if (field === "resource") {
      value = counts.resources.get(label) ?? 0;
    } else {
      const axisId = normalizeAxisId(field);
      const leafId = label === "--" ? "unclassified" : label;
      value = counts.axes[axisId]?.get(leafId) ?? 0;
    }
    element.textContent = String(value);
  });

  all("[data-selected-count]").forEach((element) => {
    const key = element.dataset.selectedCount;
    const count =
      key === "year"
        ? targetState.years.size
        : targetState.axes[normalizeAxisId(key)]?.size ?? 0;
    element.textContent = count ? String(count) : "";
    element.hidden = count === 0;
  });
}

function createLeafChip(assignment, axisId, { shared = false } = {}) {
  const template = byId("leaf-chip-template");
  const chip = template.content.firstElementChild.cloneNode(true);
  chip.dataset.axis = axisId;
  chip.dataset.role = assignment.type;
  chip.classList.add(`leaf-chip--${assignment.type}`);
  if (shared) chip.classList.add("leaf-chip--shared");
  chip.querySelector('[data-slot="leaf"]').textContent = assignment.label;
  chip.querySelector('[data-slot="role"]').textContent = assignment.type;
  chip.title = `${assignment.label} · ${assignment.type}`;
  return chip;
}

function renderAxisAssignments(container, assignments, axisId, options = {}) {
  container.replaceChildren();
  if (!assignments.length) {
    const empty = makeElement("span", "leaf-chip leaf-chip--none", "Not fixed");
    empty.dataset.axis = axisId;
    empty.dataset.role = "none";
    empty.title =
      "The symbol -- indicates that the reported research unit has no explicit category assignment in that aspect.";
    container.append(empty);
    return;
  }
  assignments.forEach((assignment) => {
    const shared = options.sharedValues?.has(assignment.value) ?? false;
    container.append(createLeafChip(assignment, axisId, { shared }));
  });
}

function resourceAnchor(kind, url, index = 0) {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) return null;
  const labels = { paper: "Paper", code: "Code", project: "Project" };
  const anchor = makeElement(
    "a",
    `resource-link resource-link--${kind}`,
    index ? `${labels[kind]} ${index + 1}` : labels[kind],
  );
  anchor.href = safeUrl;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  return anchor;
}

function renderResources(container, record) {
  container.replaceChildren();
  for (const kind of ["paper", "code", "project"]) {
    record.links[kind].forEach((url, index) => {
      const anchor = resourceAnchor(kind, url, index);
      if (anchor) container.append(anchor);
    });
  }
}

function populateResultNode(node, record) {
  node.dataset.recordId = record.id;
  node.querySelector('[data-slot="short_name"]').textContent = record.shortName;
  node.querySelector('[data-slot="title"]').textContent = record.title;
  const date = node.querySelector('[data-slot="date"]');
  date.textContent = record.date;
  if (date.tagName === "TIME") date.dateTime = record.date;

  for (const axisId of AXIS_IDS) {
    renderAxisAssignments(
      node.querySelector(`[data-slot="${axisId}"]`),
      record.axes[axisId],
      axisId,
    );
  }
  renderResources(node.querySelector('[data-slot="resources"]'), record);

  all('[data-action="open-detail"]', node).forEach((button) => {
    button.dataset.recordId = record.id;
    button.setAttribute("aria-label", `Open the Method Profile for ${record.shortName}`);
  });
  all('[data-action="toggle-comparison"]', node).forEach((input) => {
    input.dataset.recordId = record.id;
    input.checked = state.compare.has(record.id);
    input.disabled = state.compare.size >= MAX_COMPARE && !input.checked;
  });
  const compareLabel = node.querySelector('[data-slot="compare-label"]');
  if (compareLabel) compareLabel.textContent = `Select ${record.shortName} for comparison`;
}

function renderResults(records) {
  elements.tableBody.replaceChildren();
  elements.cardList.replaceChildren();
  const rowTemplate = byId("result-row-template");
  const cardTemplate = byId("result-card-template");
  for (const record of records) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    populateResultNode(row, record);
    populateResultNode(card, record);
    elements.tableBody.append(row);
    elements.cardList.append(card);
  }
}

function activeFilterItems(targetState = state) {
  const items = [];
  [...targetState.years]
    .sort((a, b) => b - a)
    .forEach((year) => items.push({ type: "year", value: year, label: String(year) }));
  for (const axisId of AXIS_IDS) {
    for (const value of targetState.axes[axisId]) {
      const label =
        value === "unclassified"
          ? "Not fixed"
          : leafMeta(axisId, value)?.label ?? value;
      items.push({
        type: "axis",
        axisId,
        value,
        label: `${axisMeta(axisId).label}: ${label}`,
      });
    }
  }
  if (targetState.status !== "all") {
    items.push({
      type: "status",
      value: targetState.status,
      label: `Role: ${targetState.status}`,
    });
  }
  if (targetState.matchMode === "all") {
    items.push({ type: "match", value: "all", label: "Require every selected category" });
  }
  for (const resource of targetState.resources) {
    items.push({
      type: "resource",
      value: resource,
      label: resource === "code" ? "Has code" : "Has project page",
    });
  }
  if (targetState.query) {
    items.push({
      type: "query",
      value: targetState.query,
      label: `Search: “${targetState.query}”`,
    });
  }
  return items;
}

function renderActiveFilters() {
  const items = activeFilterItems();
  elements.activeList.replaceChildren();
  const template = byId("active-filter-template");
  for (const item of items) {
    const chip = template.content.firstElementChild.cloneNode(true);
    chip.dataset.filterType = item.type;
    chip.dataset.filterValue = item.value;
    if (item.axisId) chip.dataset.axisId = item.axisId;
    chip.querySelector('[data-slot="filter-label"]').textContent = item.label;
    chip.setAttribute("aria-label", `Remove filter ${item.label}`);
    elements.activeList.append(chip);
  }
  elements.activeRegion.hidden = items.length === 0;
}

function querySummary(items, count) {
  if (!items.length) return "Showing all Method Profiles";
  const labels = items.slice(0, 3).map((item) => item.label);
  const remainder = items.length - labels.length;
  return `${count} works match: ${labels.join(" · ")}${remainder ? ` · +${remainder} more` : ""}`;
}

function renderPagination(pageInfo, total) {
  elements.paginationSummary.textContent = `${pageInfo.start}–${pageInfo.end} of ${total}`;
  elements.previousPage.disabled = pageInfo.page <= 1;
  elements.nextPage.disabled = pageInfo.page >= pageInfo.pageCount;
  elements.pagination.hidden = total === 0;
}

function renderCompareTray() {
  const selected = [...state.compare]
    .map((recordId) => dataset.records.find((record) => record.id === recordId))
    .filter(Boolean);
  elements.compareTray.hidden = selected.length === 0;
  elements.compareCount.textContent = String(selected.length);
  elements.compareOpen.disabled = selected.length < 2;
  elements.compareList.replaceChildren();
  for (const record of selected) {
    const item = makeElement("li", "compare-selection-item");
    item.append(makeElement("span", "", record.shortName));
    const remove = makeElement("button", "", "Remove");
    remove.type = "button";
    remove.dataset.action = "remove-comparison";
    remove.dataset.recordId = record.id;
    remove.setAttribute("aria-label", `Remove ${record.shortName} from comparison`);
    item.append(remove);
    elements.compareList.append(item);
  }
}

function renderLandscape(records) {
  if (!elements.yearLandscape && !elements.axisLandscape) return;
  const maxYearCount = Math.max(
    1,
    ...dataset.source.years.map(
      (year) => records.filter((record) => record.year === year).length,
    ),
  );
  if (elements.yearLandscape) {
    elements.yearLandscape.replaceChildren();
    for (const year of dataset.source.years) {
      const count = records.filter((record) => record.year === year).length;
      const button = makeElement("button", "landscape-bar");
      button.type = "button";
      button.dataset.action = "set-year";
      button.dataset.year = String(year);
      button.title = `Filter to ${year}`;
      const label = makeElement("span", "landscape-bar__label", String(year));
      const track = makeElement("span", "landscape-bar__track");
      const fill = makeElement("span", "landscape-bar__fill");
      fill.style.setProperty("--bar-size", `${(count / maxYearCount) * 100}%`);
      track.append(fill);
      button.append(label, track, makeElement("strong", "", String(count)));
      elements.yearLandscape.append(button);
    }
  }

  if (elements.axisLandscape) {
    elements.axisLandscape.replaceChildren();
    for (const axisId of AXIS_IDS) {
      const axis = axisMeta(axisId);
      const section = makeElement("section", "landscape-axis");
      section.dataset.axis = axisId;
      section.append(makeElement("h4", "", axis.label));
      const values = axis.leaves.map((leaf) => ({
        leaf,
        count: records.reduce(
          (total, record) =>
            total +
            Number(record.axes[axisId].some((assignment) => assignment.value === leaf.id)),
          0,
        ),
      }));
      const maxCount = Math.max(1, ...values.map((item) => item.count));
      const list = makeElement("div", "landscape-axis__list");
      for (const { leaf, count } of values) {
        const button = makeElement("button", "landscape-leaf");
        button.type = "button";
        button.dataset.action = "set-leaf";
        button.dataset.axisId = axisId;
        button.dataset.leafId = leaf.id;
        button.title = `Filter ${axis.label} to ${leaf.label}`;
        const label = makeElement("span", "landscape-leaf__label", leaf.label);
        const track = makeElement("span", "landscape-leaf__track");
        const fill = makeElement("span", "landscape-leaf__fill");
        fill.style.setProperty("--bar-size", `${(count / maxCount) * 100}%`);
        track.append(fill);
        button.append(label, track, makeElement("strong", "", String(count)));
        list.append(button);
      }
      section.append(list);
      elements.axisLandscape.append(section);
    }
  }
}

function render({ historyMode = null } = {}) {
  filteredRecords = applyState(dataset.records, state);
  const pageInfo = paginateRecords(filteredRecords, state);
  if (pageInfo.page !== state.page) state.page = pageInfo.page;
  renderResults(pageInfo.records);
  renderFacetCounts(state);
  renderActiveFilters();
  renderCompareTray();
  renderLandscape(filteredRecords);
  syncControls(state);

  elements.count.textContent = String(filteredRecords.length);
  elements.countLabel.textContent = filteredRecords.length === 1 ? "work" : "works";
  elements.querySummary.textContent = querySummary(
    activeFilterItems(),
    filteredRecords.length,
  );
  elements.noResults.hidden = filteredRecords.length !== 0;
  byId("results-table-region").hidden = filteredRecords.length === 0;
  elements.cardList.hidden = filteredRecords.length === 0;
  renderPagination(pageInfo, filteredRecords.length);
  elements.mobileFilterCount.textContent = String(selectedFilterCount(state));
  elements.mobileFilterCount.hidden = selectedFilterCount(state) === 0;
  elements.resultsSurface.setAttribute("aria-busy", "false");
  elements.status.hidden = true;

  const dateSortButton = document.querySelector('[data-sort-by="date"]');
  if (dateSortButton) {
    dateSortButton.closest("th").setAttribute(
      "aria-sort",
      state.sort === "date-desc"
        ? "descending"
        : state.sort === "date-asc"
          ? "ascending"
          : "none",
    );
  }
  if (historyMode) writeHistory(historyMode);
}

function renderPendingMobileState() {
  if (!pendingMobileState) return;
  syncControls(pendingMobileState);
  renderFacetCounts(pendingMobileState);
  elements.mobileApplyCount.textContent = String(
    applyState(dataset.records, pendingMobileState).length,
  );
}

function removeActiveFilter(button) {
  const { filterType, filterValue, axisId } = button.dataset;
  if (filterType === "year") state.years.delete(Number(filterValue));
  if (filterType === "axis") state.axes[axisId].delete(filterValue);
  if (filterType === "status") state.status = "all";
  if (filterType === "match") state.matchMode = "any";
  if (filterType === "resource") state.resources.delete(filterValue);
  if (filterType === "query") state.query = "";
  state.page = 1;
  render({ historyMode: "push" });
}

function openMobileFilters() {
  if (!elements.mobileFilterDialog || elements.mobileFilterDialog.open) return;
  pendingMobileState = cloneState(state);
  filterGroupsHome = elements.filterGroups.parentNode;
  filterGroupsNextSibling = elements.filterGroups.nextSibling;
  elements.mobileFilterMount.replaceChildren(elements.filterGroups);
  renderPendingMobileState();
  elements.mobileFilterDialog.showModal();
}

function restoreFilterGroups() {
  if (!filterGroupsHome || !elements.filterGroups) return;
  if (filterGroupsNextSibling?.parentNode === filterGroupsHome) {
    filterGroupsHome.insertBefore(elements.filterGroups, filterGroupsNextSibling);
  } else {
    filterGroupsHome.append(elements.filterGroups);
  }
}

function closeMobileFilters({ apply = false } = {}) {
  if (!elements.mobileFilterDialog.open) return;
  if (apply && pendingMobileState) {
    state = cloneState(pendingMobileState);
    state.page = 1;
  }
  restoreFilterGroups();
  pendingMobileState = null;
  elements.mobileFilterDialog.close();
  syncControls(state);
  renderFacetCounts(state);
  if (apply) render({ historyMode: "push" });
}

function toggleComparison(recordId, shouldSelect) {
  if (shouldSelect) {
    if (state.compare.size >= MAX_COMPARE && !state.compare.has(recordId)) {
      showToast(`Compare up to ${MAX_COMPARE} works at a time.`);
      return false;
    }
    state.compare.add(recordId);
  } else {
    state.compare.delete(recordId);
  }
  renderCompareTray();
  all(`[data-action="toggle-comparison"][data-record-id="${CSS.escape(recordId)}"]`).forEach(
    (input) => {
      input.checked = state.compare.has(recordId);
    },
  );
  all('[data-action="toggle-comparison"]').forEach((input) => {
    input.disabled = state.compare.size >= MAX_COMPARE && !input.checked;
  });
  writeHistory("replace");
  if (currentDetailId === recordId) updateDetailCompareButton(recordId);
  return true;
}

function updateDetailCompareButton(recordId) {
  const selected = state.compare.has(recordId);
  elements.detailCompare.textContent = selected ? "Remove from compare" : "Add to compare";
  elements.detailCompare.disabled = !selected && state.compare.size >= MAX_COMPARE;
}

function renderMechanismNeighbors(record) {
  const bodyElement = elements.detailDialog.querySelector(".dialog__body");
  bodyElement.querySelector("[data-neighbor-section]")?.remove();
  const neighbors = mechanismNeighbors(record, dataset.records, 5);
  if (!neighbors.length) return;
  const section = makeElement("section", "neighbor-section");
  section.dataset.neighborSection = "";
  section.append(makeElement("h3", "", "Nearby Method Profiles"));
  section.append(
    makeElement(
      "p",
      "neighbor-section__note",
      "Based only on shared taxonomy categories; this is not a quality or citation ranking.",
    ),
  );
  const list = makeElement("div", "neighbor-list");
  for (const item of neighbors) {
    const button = makeElement("button", "neighbor-item");
    button.type = "button";
    button.dataset.action = "open-detail";
    button.dataset.recordId = item.record.id;
    const label = makeElement("span", "", item.record.shortName);
    const meta = makeElement(
      "small",
      "",
      `${item.record.date} · ${item.sharedCount} shared ${item.sharedCount === 1 ? "category" : "categories"}`,
    );
    button.append(label, meta);
    list.append(button);
  }
  section.append(list);
  bodyElement.append(section);
}

function openDetail(recordId, { updateHash = true } = {}) {
  const record = dataset.records.find((item) => item.id === recordId);
  if (!record) return;
  currentDetailId = record.id;
  elements.detailDialog.querySelector('[data-detail-slot="short_name"]').textContent =
    record.shortName;
  elements.detailDialog.querySelector('[data-detail-slot="date"]').textContent =
    `${record.date} · ${record.citekey}`;
  elements.detailDialog.querySelector('[data-detail-slot="title"]').textContent =
    record.title;
  renderResources(
    elements.detailDialog.querySelector('[data-detail-slot="links"]'),
    record,
  );
  for (const axisId of AXIS_IDS) {
    renderAxisAssignments(
      elements.detailDialog.querySelector(
        `[data-detail-axis="${axisId}"]`,
      ),
      record.axes[axisId],
      axisId,
    );
  }
  updateDetailCompareButton(record.id);
  renderMechanismNeighbors(record);
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
  if (updateHash) writeHistory("replace", { hash: `#paper-${record.id}` });
}

function closeDetail({ clearHash = true } = {}) {
  if (elements.detailDialog.open) elements.detailDialog.close();
  currentDetailId = null;
  if (clearHash && window.location.hash.startsWith("#paper-")) {
    writeHistory("replace", { hash: "" });
  }
}

function renderComparison() {
  const selected = [...state.compare]
    .map((recordId) => dataset.records.find((record) => record.id === recordId))
    .filter(Boolean);
  elements.compareHead.replaceChildren();
  elements.compareBody.replaceChildren();
  const headRow = document.createElement("tr");
  headRow.append(makeElement("th", "", "Dimension"));
  for (const record of selected) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.append(makeElement("strong", "", record.shortName));
    cell.append(makeElement("span", "", record.date));
    const remove = makeElement("button", "compare-remove", "Remove");
    remove.type = "button";
    remove.dataset.action = "remove-comparison";
    remove.dataset.recordId = record.id;
    cell.append(remove);
    headRow.append(cell);
  }
  elements.compareHead.append(headRow);

  for (const axisId of AXIS_IDS) {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = axisMeta(axisId).label;
    row.append(heading);
    const frequencies = new Map();
    selected.forEach((record) => {
      record.axes[axisId].forEach((assignment) => {
        frequencies.set(assignment.value, (frequencies.get(assignment.value) ?? 0) + 1);
      });
    });
    const sharedValues = new Set(
      [...frequencies]
        .filter(([, count]) => count === selected.length)
        .map(([value]) => value),
    );
    for (const record of selected) {
      const cell = document.createElement("td");
      const list = makeElement("div", "leaf-list");
      renderAxisAssignments(list, record.axes[axisId], axisId, { sharedValues });
      cell.append(list);
      row.append(cell);
    }
    elements.compareBody.append(row);
  }
}

function openComparison() {
  if (state.compare.size < 2) {
    showToast("Select at least two works to compare.");
    return;
  }
  renderComparison();
  elements.compareDialog.showModal();
}

function filterByLandscapeLeaf(axisId, leafId) {
  state.axes[axisId].clear();
  state.axes[axisId].add(leafId);
  state.page = 1;
  render({ historyMode: "push" });
  byId("matrix-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyPreset(button) {
  const rawQuery = button.dataset.presetQuery ?? "";
  const { state: presetState, warnings } = parseState(`?${rawQuery}`, dataset);
  presetState.compare = new Set(state.compare);
  presetState.pageSize = state.pageSize;
  state = presetState;
  if (warnings.length) showToast(warnings[0]);
  render({ historyMode: "push" });
  byId("matrix-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;
  if (action === "clear-search") {
    state.query = "";
    state.page = 1;
    render({ historyMode: "push" });
  }
  if (action === "clear-all-filters") {
    state = freshFilterState();
    render({ historyMode: "push" });
  }
  if (action === "remove-filter") removeActiveFilter(target);
  if (action === "open-mobile-filters") openMobileFilters();
  if (action === "close-mobile-filters") closeMobileFilters();
  if (action === "apply-mobile-filters") closeMobileFilters({ apply: true });
  if (action === "reset-mobile-filters") {
    pendingMobileState = freshFilterState(pendingMobileState);
    renderPendingMobileState();
  }
  if (action === "previous-page" && state.page > 1) {
    state.page -= 1;
    render({ historyMode: "push" });
    byId("results-surface").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action === "next-page") {
    state.page += 1;
    render({ historyMode: "push" });
    byId("results-surface").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action === "include-inherited") {
    state.status = "all";
    state.page = 1;
    render({ historyMode: "push" });
  }
  if (action === "toggle-date-sort") {
    state.sort = state.sort === "date-desc" ? "date-asc" : "date-desc";
    state.page = 1;
    render({ historyMode: "push" });
  }
  if (action === "copy-query-link") {
    const url = new URL(window.location.href);
    url.hash = "";
    copyText(url.href, "Result link copied.");
  }
  if (action === "export-results") {
    downloadText(
      recordsToCsv(filteredRecords),
      exportFileName(state, filteredRecords.length),
      "text/csv;charset=utf-8",
    );
    showToast(`Exported ${filteredRecords.length} works.`);
  }
  if (action === "open-detail") openDetail(target.dataset.recordId);
  if (action === "close-detail") closeDetail();
  if (action === "toggle-comparison") {
    toggleComparison(target.dataset.recordId, target.checked);
  }
  if (action === "remove-comparison") {
    toggleComparison(target.dataset.recordId, false);
    if (elements.compareDialog.open) {
      if (state.compare.size < 2) elements.compareDialog.close();
      else renderComparison();
    }
  }
  if (action === "clear-comparison") {
    state.compare.clear();
    render({ historyMode: "replace" });
  }
  if (action === "open-compare") openComparison();
  if (action === "close-compare") elements.compareDialog.close();
  if (action === "copy-detail-link" && currentDetailId) {
    const url = new URL(window.location.href);
    url.hash = `paper-${currentDetailId}`;
    copyText(url.href, "Work link copied.");
  }
  if (action === "toggle-detail-comparison" && currentDetailId) {
    toggleComparison(currentDetailId, !state.compare.has(currentDetailId));
  }
  if (action === "copy-compare-link") {
    const url = new URL(window.location.href);
    url.hash = "";
    copyText(url.href, "Comparison link copied.");
  }
  if (action === "export-comparison") {
    const selected = [...state.compare]
      .map((id) => dataset.records.find((record) => record.id === id))
      .filter(Boolean);
    downloadText(
      recordsToCsv(selected),
      `speculative-decoding-comparison_${selected.length}.csv`,
      "text/csv;charset=utf-8",
    );
  }
  if (action === "set-year") {
    state.years.clear();
    state.years.add(Number(target.dataset.year));
    state.page = 1;
    render({ historyMode: "push" });
  }
  if (action === "set-leaf") {
    filterByLandscapeLeaf(target.dataset.axisId, target.dataset.leafId);
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) {
      applyPreset(preset);
      return;
    }
    const axisJump = event.target.closest("[data-axis-jump]");
    if (axisJump) {
      const groupIdByAxis = {
        draftSource: "filter-group-draft-source",
        draftGeometry: "filter-group-draft-geometry",
        verificationFidelity: "filter-group-verification-fidelity",
        runtimeExecution: "filter-group-runtime-execution",
      };
      const group = byId(groupIdByAxis[axisJump.dataset.axisJump]);
      if (window.matchMedia("(max-width: 1100px)").matches) openMobileFilters();
      if (group) {
        group.open = true;
        group.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget && actionTarget.type !== "checkbox") handleAction(actionTarget);
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (
      input !== elements.search &&
      input.matches("[data-filter-axis], [data-filter-key]")
    ) {
      const workingState = currentWorkingState();
      updateStateFromControl(input, workingState);
      if (pendingMobileState) renderPendingMobileState();
      else render({ historyMode: "push" });
      return;
    }
    if (input.matches('[data-action="toggle-comparison"]')) {
      handleAction(input);
      return;
    }
    if (input === elements.sort) {
      state.sort = input.value;
      state.page = 1;
      render({ historyMode: "push" });
      return;
    }
    if (input === elements.pageSize) {
      state.pageSize = input.value;
      state.page = 1;
      render({ historyMode: "push" });
    }
  });

  elements.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = elements.search.value.trim();
      state.page = 1;
      render({ historyMode: "replace" });
    }, 180);
    elements.searchClear.hidden = !elements.search.value;
  });
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    state.query = elements.search.value.trim();
    state.page = 1;
    render({ historyMode: "push" });
    byId("matrix-results").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("popstate", () => {
    const parsed = parseState(window.location.search, dataset);
    state = parsed.state;
    render();
    handleLocationHash();
  });

  window.addEventListener("hashchange", handleLocationHash);
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      elements.search.focus();
    }
  });

  elements.detailDialog.addEventListener("close", () => {
    if (currentDetailId) closeDetail();
  });
  elements.mobileFilterDialog.addEventListener("close", () => {
    if (pendingMobileState) {
      restoreFilterGroups();
      pendingMobileState = null;
      syncControls(state);
      renderFacetCounts(state);
    }
  });
}

function handleLocationHash() {
  const match = window.location.hash.match(/^#paper-(AS\d{4}_B\d{4})$/);
  if (match) openDetail(match[1], { updateHash: false });
  else if (currentDetailId) closeDetail({ clearHash: false });
}

async function init() {
  try {
    const response = await fetch(dataSource, { cache: "no-store" });
    if (!response.ok) throw new Error(`Method Profile data returned ${response.status}`);
    dataset = await response.json();
    if (
      dataset.schemaVersion !== 2 ||
      dataset.records.length !== dataset.source.recordCount
    ) {
      throw new Error("Method Profile data schema validation failed");
    }
    const parsed = parseState(window.location.search, dataset);
    state = parsed.state;
    updateCorpusMeta();
    bindEvents();
    syncControls(state);
    render();
    if (parsed.warnings.length) showToast(parsed.warnings[0]);
    handleLocationHash();
  } catch (error) {
    console.error(error);
    elements.status.hidden = true;
    elements.resultsSurface.setAttribute("aria-busy", "false");
    byId("results-table-region").hidden = true;
    elements.cardList.hidden = true;
    elements.pagination.hidden = true;
    elements.error.hidden = false;
  }
}

init();
