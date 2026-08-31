function indexName(fields, options = {}) {
  return options.name || Object.entries(fields).map(([field, direction]) => `${field}_${direction}`).join("_");
}

function sameKey(a = {}, b = {}) {
  const aa = Object.entries(a);
  const bb = Object.entries(b);
  return aa.length === bb.length && aa.every(([key, value], i) => bb[i]?.[0] === key && bb[i]?.[1] === value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameIndex(existing, fields, options = {}) {
  if (!sameKey(existing?.key, fields)) return false;
  if (Boolean(existing.unique) !== Boolean(options.unique)) return false;
  if (Boolean(existing.sparse) !== Boolean(options.sparse)) return false;
  if (JSON.stringify(stable(existing.partialFilterExpression || null)) !== JSON.stringify(stable(options.partialFilterExpression || null))) return false;
  if (options.name && existing.name !== options.name) return false;
  return true;
}

function duplicateMatch(fields, options = {}) {
  if (options.partialFilterExpression) return options.partialFilterExpression;
  if (options.sparse) {
    const keys = Object.keys(fields);
    return keys.length === 1 ? { [keys[0]]: { $exists: true } } : { $or: keys.map((key) => ({ [key]: { $exists: true } })) };
  }
  return {};
}

async function findDuplicate(collection, fields, options = {}) {
  if (!options.unique) return null;
  const groupId = Object.fromEntries(Object.keys(fields).map((field) => [field.replaceAll(".", "__"), `$${field}`]));
  const rows = await collection.aggregate([
    { $match: duplicateMatch(fields, options) },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  return rows[0] || null;
}

async function ensureCollectionIndex(collection, fields, options = {}) {
  const desiredName = indexName(fields, options);
  const indexes = await collection.indexes();
  const conflicts = indexes.filter((item) => item.name !== "_id_" && (item.name === desiredName || sameKey(item.key, fields)));
  const exact = conflicts.find((item) => sameIndex(item, fields, options));
  if (exact) return { status: "existing", name: exact.name, dropped: [] };

  const duplicate = await findDuplicate(collection, fields, options);
  if (duplicate) {
    const err = new Error(`Cannot create unique index ${desiredName}: duplicate key group exists (${JSON.stringify(duplicate._id)}).`);
    err.code = "INDEX_DUPLICATES_PRESENT";
    throw err;
  }

  const dropped = [];
  for (const item of conflicts) {
    await collection.dropIndex(item.name);
    dropped.push(item.name);
  }
  const createdName = await collection.createIndex(fields, options);
  return { status: dropped.length ? "replaced" : "created", name: createdName || desiredName, dropped };
}

module.exports = { indexName, sameKey, sameIndex, duplicateMatch, findDuplicate, ensureCollectionIndex };
