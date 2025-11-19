const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// statuses allowed
const STATUSES = ['to_pay','to_ship','to_receive','completed','refund','cancelled'];

// list orders (admin OR customer)
router.get('/', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/users/login');

  const db = req.app.locals.client.db(req.app.locals.dbName);
  let orders;

  if (user.role === 'admin') {
    orders = await db.collection('orders').find().sort({ createdAt: -1 }).toArray();
  } else {
    const uid = user.userId;
    const query = { $or: [{ userId: uid }, { userId: String(uid) }] };
    orders = await db.collection('orders').find(query).sort({ createdAt: -1 }).toArray();
  }

  res.render('orders', { title: 'Orders', orders, user: req.session.user || null, success: req.query.success || null });
});

// single order detail (admin + owner)
router.get('/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  const db = req.app.locals.client.db(req.app.locals.dbName);
  const order = await db.collection('orders').findOne({ orderId });
  if (!order) return res.status(404).render('error', { message: 'Order not found', error: {status:404} });

  // allow admin or owner
  if (!req.session.user || (req.session.user.role !== 'admin' && String(req.session.user.userId) !== String(order.userId))) {
    return res.status(403).render('error', { message: 'Forbidden', error: { status: 403 } });
  }

  res.render('order-detail', { title: `Order ${order.orderId}`, order, user: req.session.user || null, statuses: STATUSES });
});

// update status (admin only)
router.post('/:orderId/status', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Unauthorized');
  const orderId = req.params.orderId;
  const newStatus = req.body.status;
  if (!STATUSES.includes(newStatus)) return res.redirect(`/orders/${orderId}?error=invalid_status`);
  const db = req.app.locals.client.db(req.app.locals.dbName);
  await db.collection('orders').updateOne({ orderId }, { $set: { orderStatus: newStatus, updatedAt: new Date() } });
  res.redirect(`/orders/${orderId}`);
});


// Create order (accepts JSON or form data)
router.post('/', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/users/login');
  }

  // items may be sent as JSON (application/json) or as a stringified JSON in form body
  let items = req.body.items;
  if (!items) {
    return res.status(400).send('Missing items');
  }

  try {
    if (typeof items === 'string') {
      items = JSON.parse(items);
    }
  } catch (err) {
    return res.status(400).send('Invalid items format');
  }

  const totalAmount = parseFloat(req.body.totalAmount) || 0;
  const order = {
    orderId: uuidv4(),
    userId: user.userId,
    items,
    totalAmount,
    orderStatus: 'to_pay',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const db = req.app.locals.client.db(req.app.locals.dbName);
  await db.collection('orders').insertOne(order);

  if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
    return res.status(201).json({ success: true, order });
  }
    // Redirect to orders page with a success alert (no separate confirmation page)
    return res.redirect(`/orders?success=Order%20placed%20successfully`);
});

// Cancel order (owner or admin)
router.post('/:orderId/cancel', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/users/login');
  }

  const orderId = req.params.orderId;
  const db = req.app.locals.client.db(req.app.locals.dbName);
  const order = await db.collection('orders').findOne({ orderId });
  if (!order) {
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.status(404).render('error', { message: 'Order not found', error: { status: 404 } });
  }

  if (user.role !== 'admin' && String(user.userId) !== String(order.userId)) {
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.status(403).render('error', { message: 'Forbidden', error: { status: 403 } });
  }

  // Prevent cancelling already completed/refunded/cancelled orders
  if (['completed', 'refund', 'cancelled'].includes(order.orderStatus)) {
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.status(400).json({ error: 'Cannot cancel order in current status' });
    }
    return res.redirect(`/orders/${orderId}?error=cannot_cancel`);
  }

  await db.collection('orders').updateOne({ orderId }, { $set: { orderStatus: 'cancelled', updatedAt: new Date() } });

  if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
    return res.json({ success: true });
  }

  return res.redirect(`/orders/${orderId}`);
});

module.exports = router;