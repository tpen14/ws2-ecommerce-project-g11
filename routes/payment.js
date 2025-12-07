const express = require('express');
const router = express.Router();

// Payment page - show payment options
router.get('/pay/:orderId', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/users/login');

  const orderId = req.params.orderId;
  const db = req.app.locals.client.db(req.app.locals.dbName);
  
  try {
    const order = await db.collection('orders').findOne({ orderId });
    
    if (!order) {
      return res.status(404).render('404', { message: 'Order not found' });
    }

    // Check if user owns this order
    if (user.role !== 'admin' && String(user.userId) !== String(order.userId)) {
      return res.status(403).render('403', { message: 'Unauthorized access' });
    }

    // Check if order is in 'to pay' status
    if (order.orderStatus !== 'to pay') {
      return res.redirect(`/orders/${orderId}?error=Order is not pending payment`);
    }

    res.render('payment', { 
      title: 'Payment', 
      order, 
      user 
    });
  } catch (err) {
    console.error('Error loading payment page:', err);
    res.status(500).send('Server error');
  }
});

// Process payment
router.post('/process/:orderId', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/users/login');

  const orderId = req.params.orderId;
  const paymentMethod = req.body.paymentMethod;
  const db = req.app.locals.client.db(req.app.locals.dbName);

  try {
    const order = await db.collection('orders').findOne({ orderId });
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if user owns this order
    if (user.role !== 'admin' && String(user.userId) !== String(order.userId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Check if order is in 'to pay' status
    if (order.orderStatus !== 'to pay') {
      return res.json({ success: false, message: 'Order is not pending payment' });
    }

    // Validate payment method
    const validMethods = ['cod', 'qr', 'paypal', 'card'];
    if (!validMethods.includes(paymentMethod)) {
      return res.json({ success: false, message: 'Invalid payment method' });
    }

    // For COD, keep status as 'to pay' but add payment method
    // For other methods, simulate successful payment and move to 'to ship'
    let newStatus = 'to ship';
    let paymentInfo = {
      method: paymentMethod,
      paidAt: new Date(),
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase()
    };

    // For COD, status stays 'to pay' until delivery
    if (paymentMethod === 'cod') {
      newStatus = 'to ship';
      paymentInfo.paidAt = null; // Will be paid on delivery
      paymentInfo.transactionId = 'COD-' + Date.now();
    }

    // For card payments, collect card details (pseudo validation)
    if (paymentMethod === 'card') {
      const cardNumber = req.body.cardNumber;
      const cardName = req.body.cardName;
      const expiryDate = req.body.expiryDate;
      const cvv = req.body.cvv;

      if (!cardNumber || !cardName || !expiryDate || !cvv) {
        return res.json({ success: false, message: 'Missing card details' });
      }

      // Pseudo validation (just check if fields are filled)
      if (cardNumber.replace(/\s/g, '').length < 13 || cvv.length < 3) {
        return res.json({ success: false, message: 'Invalid card details' });
      }

      paymentInfo.cardLast4 = cardNumber.replace(/\s/g, '').slice(-4);
      paymentInfo.cardName = cardName;
    }

    // For PayPal, collect email
    if (paymentMethod === 'paypal') {
      const paypalEmail = req.body.paypalEmail;
      if (!paypalEmail || !paypalEmail.includes('@')) {
        return res.json({ success: false, message: 'Invalid PayPal email' });
      }
      paymentInfo.paypalEmail = paypalEmail;
    }

    // Update order with payment information
    await db.collection('orders').updateOne(
      { orderId },
      { 
        $set: { 
          orderStatus: newStatus,
          paymentInfo: paymentInfo,
          updatedAt: new Date()
        } 
      }
    );

    res.json({ 
      success: true, 
      message: 'Payment processed successfully',
      orderId: orderId,
      transactionId: paymentInfo.transactionId
    });

  } catch (err) {
    console.error('Error processing payment:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;