const ID_FIELDS = ["id", "groupId", "groupID"];
const NAME_FIELDS = [
  "groupName",
  "name",
  "nameEn",
  "nameAr",
  "groupNameEn",
  "groupNameAr",
];

const ARRAY_PATHS = [
  ["response", "data", "items"],
  ["response", "data", "records"],
  ["response", "data", "results"],
  ["response", "data", "list"],
  ["response", "data"],
  ["data", "items"],
  ["data", "records"],
  ["data", "results"],
  ["data", "list"],
  ["data"],
  ["items"],
  ["records"],
  ["results"],
  ["list"],
  [],
];

function atPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function scalarField(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    if ((typeof value === "string" && value.trim()) || typeof value === "number") {
      return value;
    }
  }
  return null;
}

export function extractGroups(json) {
  let records = null;
  for (const path of ARRAY_PATHS) {
    const candidate = atPath(json, path);
    if (Array.isArray(candidate)) {
      if (candidate.length === 0 || candidate.some((entry) => scalarField(entry, ID_FIELDS) !== null)) {
        records = candidate;
        break;
      }
    }
  }
  if (!records) return null;

  const seen = new Set();
  const groups = [];
  for (const record of records) {
    const id = scalarField(record, ID_FIELDS);
    if (id === null) continue;
    const key = `${typeof id}:${String(id)}`;
    if (seen.has(key)) throw new Error(`Duplicate group ID in response: ${id}`);
    seen.add(key);
    const name = scalarField(record, NAME_FIELDS);
    groups.push({ id, name: name === null ? "(unnamed group)" : String(name), raw: record });
  }
  return groups;
}

export function formatGroups(groups) {
  if (!groups.length) return "No groups found.";
  const width = String(groups.length).length;
  return groups.map((group, index) =>
    `  ${String(index + 1).padStart(width)}. ${group.name}  (ID: ${group.id})`
  ).join("\n");
}

export function parseGroupSelection(value, groups) {
  const selection = Number(String(value).trim());
  if (!Number.isInteger(selection) || selection < 1 || selection > groups.length) return null;
  return groups[selection - 1];
}

export function normalizeGroupId(value) {
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (/^(0|[1-9]\d*)$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric) && String(numeric) === text) return numeric;
  }
  return text;
}
