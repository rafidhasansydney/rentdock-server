const cardProjection = { _id: 1, name: 1, category: 1, location: 1, price: 1, rentalType: 1, availableQuantity: 1, image: 1, imageAlt: 1, description: 1, createdAt: 1, isSample: 1 };
export function publicEquipment(record) {
  const { _id, availableQuantity, ...fields } = record;
  return { ...fields, id: String(_id), available: availableQuantity > 0 };
}
export function createCatalogRepository(database) {
  const collections = async () => {
    const db = await database.connect();
    return { equipment: db.collection("equipment"), favorites: db.collection("favorites") };
  };
  return {
    async ensureIndexes() {
      const { equipment, favorites } = await collections();
      await Promise.all([
        equipment.createIndex({ status: 1, createdAt: -1, _id: 1 }),
        equipment.createIndex({ status: 1, category: 1, price: 1 }),
        favorites.createIndex({ userId: 1, equipmentId: 1 }, { unique: true }),
      ]);
    },
    async list({ filter, sort, page, limit }) {
      const { equipment } = await collections();
      const [records, total] = await Promise.all([
        equipment.find(filter, { projection: cardProjection }).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
        equipment.countDocuments(filter),
      ]);
      return { items: records.map(publicEquipment), total, page, pages: Math.ceil(total / limit), limit };
    },
    async highlights() {
      const { equipment } = await collections();
      const [featured, recent] = await Promise.all([
        equipment.find({ status: "approved" }, { projection: cardProjection }).sort({ featured: -1, createdAt: -1, _id: 1 }).limit(6).toArray(),
        equipment.find({ status: "approved" }, { projection: cardProjection }).sort({ createdAt: -1, _id: 1 }).limit(2).toArray(),
      ]);
      return { featured: featured.map(publicEquipment), recent: recent.map(publicEquipment) };
    },
    async details(id) {
      const { equipment } = await collections();
      const record = await equipment.findOne({ _id: id, status: "approved" });
      if (!record) return null;
      const card = publicEquipment(Object.fromEntries(Object.keys(cardProjection).filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])));
      return { ...card, quantity: record.availableQuantity, condition: record.condition, included: record.included ?? [], terms: record.terms ?? [], owner: { name: record.ownerName || "Equipment owner" } };
    },
    async addFavorite(userId, equipmentId) {
      const { equipment, favorites } = await collections();
      if (!await equipment.findOne({ _id: equipmentId, status: "approved" }, { projection: { _id: 1 } })) return false;
      try { await favorites.updateOne({ userId, equipmentId }, { $setOnInsert: { userId, equipmentId, createdAt: new Date() } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
      return true;
    },
    async removeFavorite(userId, equipmentId) {
      const { favorites } = await collections();
      await favorites.deleteOne({ userId, equipmentId });
    },
    async favoriteStatus(userId, equipmentId) {
      const { favorites } = await collections();
      return Boolean(await favorites.findOne({ userId, equipmentId }, { projection: { _id: 1 } }));
    },
    async favorites(userId, page) {
      const { favorites } = await collections();
      const base = [
        { $match: { userId } },
        { $lookup: { from: "equipment", localField: "equipmentId", foreignField: "_id", as: "equipment" } },
        { $unwind: "$equipment" },
        { $match: { "equipment.status": "approved" } },
        { $sort: { createdAt: -1, equipmentId: 1 } },
        { $facet: { items: [{ $skip: (page - 1) * 12 }, { $limit: 12 }, { $replaceRoot: { newRoot: "$equipment" } }, { $project: cardProjection }], count: [{ $count: "total" }] } },
      ];
      const [result] = await favorites.aggregate(base).toArray();
      const total = result?.count[0]?.total ?? 0;
      return { items: (result?.items ?? []).map(publicEquipment), total, page, pages: Math.ceil(total / 12), limit: 12 };
    },
  };
}
