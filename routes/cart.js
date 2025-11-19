const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// show cart
router.get('/', (req, res) => {
  const cart = req.session.cart || { items: [], totalAmount: 0 };
  res.render('cart', { title: 'Your Cart', cart, user: req.session.user || null });
});

// add to cart (form or AJAX)
router.post('/add', async (req, res) => {
  try {
    const productId = parseInt(req.body.productId, 10);
    const qty = Math.max(1, parseInt(req.body.quantity || 1, 10));
    const db = req.app.locals.client.db(req.app.locals.dbName);
    const product = await db.collection('products').findOne({ productId });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    req.session.cart = req.session.cart || { items: [], totalAmount: 0 };
    const items = req.session.cart.items;

    const existing = items.find(i => i.productId === product.productId);
    if (existing) {
      existing.quantity += qty;
      existing.subtotal = existing.price * existing.quantity;
    } else {
      items.push({
        productId: product.productId,
        name: product.name,
        price: product.price,
        quantity: qty,
        subtotal: product.price * qty,
        image: product.image || '/images/default-product.jpg'
      });
    }

    req.session.cart.totalAmount = items.reduce((s, i) => s + i.subtotal, 0);
    await req.session.save?.bind(req.session)?.();
    // If request expects JSON (AJAX), return json, otherwise redirect back.
    if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
      return res.json({ ok: true, cart: req.session.cart });
    }
    res.redirect('/cart');
  } catch (err) {
    console.error('Cart add error', err);
    res.status(500).send('Server error');
  }
});

// update quantity
router.post('/update', (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  const qty = Math.max(0, parseInt(req.body.quantity || 0, 10));
  req.session.cart = req.session.cart || { items: [], totalAmount: 0 };
  const items = req.session.cart.items;
  const idx = items.findIndex(i => i.productId === productId);
  if (idx === -1) return res.redirect('/cart');
  if (qty === 0) items.splice(idx, 1);
  else {
    items[idx].quantity = qty;
    items[idx].subtotal = items[idx].price * qty;
  }
  req.session.cart.totalAmount = items.reduce((s, i) => s + i.subtotal, 0);
  req.session.save?.bind(req.session)?.(() => res.redirect('/cart'));
});

// remove item
router.post('/remove', (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  req.session.cart = req.session.cart || { items: [], totalAmount: 0 };
  req.session.cart.items = req.session.cart.items.filter(i => i.productId !== productId);
  req.session.cart.totalAmount = (req.session.cart.items || []).reduce((s, i) => s + i.subtotal, 0);
  req.session.save?.bind(req.session)?.(() => res.redirect('/cart'));
});

// checkout -> create order (requires login)
router.post('/checkout', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/users/login');
    const cart = req.session.cart;
    if (!cart || !cart.items || cart.items.length === 0) return res.redirect('/cart?error=empty');

    // Collect customer info from form (prefilled for logged-in users in the view)
    const customerName = req.body.customerName?.trim();
    const customerEmail = req.body.customerEmail?.trim();
    const shippingAddress = req.body.shippingAddress?.trim();

    if (!customerName || !customerEmail || !shippingAddress) {
      return res.redirect('/cart?error=missing_info');
    }

    const db = req.app.locals.client.db(req.app.locals.dbName);
    const orderId = uuidv4();
    const order = {
      orderId,
      userId: req.session.user.userId,
      customerName,
      customerEmail,
      shippingAddress,
      items: cart.items.map(i => ({
        productId: i.productId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        subtotal: i.subtotal
      })),
      totalAmount: cart.totalAmount,
      orderStatus: 'to_pay',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('orders').insertOne(order);

    // clear cart
    req.session.cart = { items: [], totalAmount: 0 };
    await req.session.save?.bind(req.session)?.();
    res.redirect(`/orders/${orderId}`);
  } catch (err) {
    console.error('Checkout error', err);
    res.status(500).send('Server error during checkout');
  }
});

module.exports = router;    