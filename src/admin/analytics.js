import { dhakaToday } from "../bookings/policy.js";

export function analyticsMonths(now = new Date()) {
  const [year, month] = dhakaToday(now).split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7));
}
export function createAnalyticsRepository(database, { clock = () => new Date() } = {}) {
  return {
    async summary(ownerId) {
      const db = await database.connect(), now = clock(), today = dhakaToday(now), months = analyticsMonths(now);
      const start = new Date(`${months[0]}-01T00:00:00+06:00`), scope = ownerId ? { ownerId } : {};
      const completed = { ...scope, $or: [{ bookingStatus: "completed" }, { bookingStatus: { $in: ["confirmed", "ongoing"] }, endDate: { $lt: today } }] };
      const groupMonth = { $dateToString: { date: "$createdAt", format: "%Y-%m", timezone: "Asia/Dhaka" } };
      const paid = { ...scope, status: "paid", currency: "bdt" };
      const [users, equipment, bookings, completedRentals, total, monthlyBookings, monthlyPayments] = await Promise.all([
        ownerId ? Promise.resolve(undefined) : db.collection("user").countDocuments({}),
        db.collection("equipment").aggregate([{ $match: { ...scope, status: { $in: ["pending", "approved", "rejected"] } } }, { $group: { _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } }, approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } } } }]).toArray(),
        db.collection("bookings").countDocuments(scope),
        db.collection("bookings").countDocuments(completed),
        db.collection("payments").aggregate([{ $match: paid }, { $group: { _id: null, amount: { $sum: "$amountMinor" } } }]).toArray(),
        db.collection("bookings").aggregate([{ $match: { ...scope, createdAt: { $gte: start, $lte: now } } }, { $group: { _id: groupMonth, count: { $sum: 1 } } }]).toArray(),
        db.collection("payments").aggregate([{ $match: { ...paid, createdAt: { $gte: start, $lte: now } } }, { $group: { _id: groupMonth, amount: { $sum: "$amountMinor" } } }]).toArray(),
      ]);
      return { users, equipment: equipment[0]?.total || 0, pendingApprovals: equipment[0]?.pending || 0, approvedEquipment: equipment[0]?.approved || 0, rejectedEquipment: equipment[0]?.rejected || 0, bookings, completedRentals, revenueMinor: total[0]?.amount || 0, currency: "bdt", monthly: months.map(month => ({ month, bookings: monthlyBookings.find(row => row._id === month)?.count || 0, revenueMinor: monthlyPayments.find(row => row._id === month)?.amount || 0 })) };
    },
  };
}
