const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');

// Reuse order statuses from orders route semantics
const STATUSES = ['to pay','to ship','to receive','completed','refund','cancelled'];

// Admin sales overview
router.get('/sales', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/users/login');
  }

  const db = req.app.locals.client.db(req.app.locals.dbName);

  // Filters
  const start = req.query.start ? new Date(req.query.start) : null;
  const end = req.query.end ? new Date(req.query.end) : null;
  const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null;

  // Build query
  const q = {};
  if (start || end) {
    q.createdAt = {};
    if (start) q.createdAt.$gte = new Date(start.setHours(0,0,0,0));
    if (end) q.createdAt.$lte = new Date(end.setHours(23,59,59,999));
  }
  if (status) q.orderStatus = status;

  try {
    const ordersCol = db.collection('orders');

    // Summary totals
    const summaryAgg = [
      { $match: q },
      {
        $group: {
          _id: null,
          totalSales: { $sum: { $ifNull: ['$totalAmount', 0] } },
          ordersCount: { $sum: 1 }
        }
      }
    ];
    const summary = (await ordersCol.aggregate(summaryAgg).toArray())[0] || { totalSales: 0, ordersCount: 0 };

    // Daily sales aggregation
    const dailyAgg = [];
    if (Object.keys(q).length) dailyAgg.push({ $match: q });
    dailyAgg.push({
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: { $ifNull: ['$totalAmount', 0] } },
        orders: { $sum: 1 }
      }
    }, { $sort: { '_id': 1 } });

    const daily = await ordersCol.aggregate(dailyAgg).toArray();

    // Prepare recent orders sample for detailed view (limit 200)
    const orders = await ordersCol.find(q).sort({ createdAt: -1 }).limit(200).toArray();

    res.render('admin-sales', {
      title: 'Admin - Sales Reports',
      user: req.session.user,
      filters: { start: req.query.start || '', end: req.query.end || '', status: status || '' },
      summary,
      daily,
      orders,
      statuses: STATUSES
    });
  } catch (err) {
    console.error('Error building sales report', err);
    res.status(500).render('admin-sales', { title: 'Admin - Sales Reports', user: req.session.user, error: 'Failed to generate report', filters: {}, summary: { totalSales:0, ordersCount:0 }, daily: [], orders: [], statuses: STATUSES });
  }
});

// Export daily sales XLSX
router.get('/sales/export/daily', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Unauthorized');
  const db = req.app.locals.client.db(req.app.locals.dbName);

  const start = req.query.start ? new Date(req.query.start) : null;
  const end = req.query.end ? new Date(req.query.end) : null;
  const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = {};
  if (start || end) {
    q.createdAt = {};
    if (start) q.createdAt.$gte = new Date(start.setHours(0,0,0,0));
    if (end) q.createdAt.$lte = new Date(end.setHours(23,59,59,999));
  }
  if (status) q.orderStatus = status;

  try {
    const dailyAgg = [];
    if (Object.keys(q).length) dailyAgg.push({ $match: q });
    dailyAgg.push({
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: { $ifNull: ['$totalAmount', 0] } },
        orders: { $sum: 1 }
      }
    }, { $sort: { '_id': 1 } });

    const daily = await db.collection('orders').aggregate(dailyAgg).toArray();

    // Build worksheet data
    const rows = daily.map(r => ({ Date: r._id, TotalSales: r.total, Orders: r.orders }));
    // add totals row
    const totalSalesSum = rows.reduce((s, r) => s + (Number(r.TotalSales) || 0), 0);
    const totalOrdersSum = rows.reduce((s, r) => s + (Number(r.Orders) || 0), 0);
    rows.push({ Date: 'TOTAL', TotalSales: totalSalesSum, Orders: totalOrdersSum });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['Date','TotalSales','Orders'] });
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Sales');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="daily_sales_report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (err) {
    console.error('Error exporting daily sales', err);
    return res.status(500).send('Export failed');
  }
});

// Export detailed orders XLSX
router.get('/sales/export/detailed', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Unauthorized');
  const db = req.app.locals.client.db(req.app.locals.dbName);

  const start = req.query.start ? new Date(req.query.start) : null;
  const end = req.query.end ? new Date(req.query.end) : null;
  const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = {};
  if (start || end) {
    q.createdAt = {};
    if (start) q.createdAt.$gte = new Date(start.setHours(0,0,0,0));
    if (end) q.createdAt.$lte = new Date(end.setHours(23,59,59,999));
  }
  if (status) q.orderStatus = status;

  try {
    const orders = await db.collection('orders').find(q).sort({ createdAt: -1 }).toArray();
    const rows = orders.map(o => ({
      OrderID: o.orderId,
      DateTime: o.createdAt ? new Date(o.createdAt).toISOString() : '',
      UserID: o.userId || '',
      Status: o.orderStatus || '',
      TotalAmount: o.totalAmount || 0
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['OrderID','DateTime','UserID','Status','TotalAmount'] });
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="detailed_orders_report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (err) {
    console.error('Error exporting detailed orders', err);
    return res.status(500).send('Export failed');
  }
});

// Print-friendly view
router.get('/sales/print', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') return res.redirect('/users/login');
  const db = req.app.locals.client.db(req.app.locals.dbName);

  const start = req.query.start ? new Date(req.query.start) : null;
  const end = req.query.end ? new Date(req.query.end) : null;
  const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = {};
  if (start || end) {
    q.createdAt = {};
    if (start) q.createdAt.$gte = new Date(start.setHours(0,0,0,0));
    if (end) q.createdAt.$lte = new Date(end.setHours(23,59,59,999));
  }
  if (status) q.orderStatus = status;

  try {
    const summaryAgg = [ { $match: q }, { $group: { _id: null, totalSales: { $sum: { $ifNull: ['$totalAmount',0] } }, ordersCount: { $sum: 1 } } } ];
    const summary = (await db.collection('orders').aggregate(summaryAgg).toArray())[0] || { totalSales: 0, ordersCount: 0 };
    const dailyAgg = [];
    if (Object.keys(q).length) dailyAgg.push({ $match: q });
    dailyAgg.push({ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: { $ifNull: ['$totalAmount',0] } }, orders: { $sum: 1 } } }, { $sort: { '_id': 1 } });
    const daily = await db.collection('orders').aggregate(dailyAgg).toArray();
    res.render('admin-sales-print', { title: 'Sales Report - Print', filters: { start: req.query.start || '', end: req.query.end || '', status: status || '' }, summary, daily });
  } catch (err) {
    console.error('Error building print view', err);
    res.status(500).render('admin-sales-print', { title: 'Sales Report - Print', filters: {}, summary: { totalSales:0, ordersCount:0 }, daily: [] });
  }
});

module.exports = router;

