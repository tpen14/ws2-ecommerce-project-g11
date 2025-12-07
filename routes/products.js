// routes/users.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Create unique filename with timestamp and original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'product-' + uniqueSuffix + ext);
    }
});

// File filter - only allow image files
const fileFilter = function (req, file, cb) {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Configure upload
const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max file size
    }
});

// Allowed product categories
const CATEGORIES = [
  'White Chocolate',
  'Dark Chocolate',
  'Milk Chocolate',
  'Cacao Blends'
];

// Product list route (supports server-side search by name and filter by category)
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.client.db(req.app.locals.dbName);

    // Read search params from query string
    const q = req.query.q ? String(req.query.q).trim() : '';
    let selectedCategory = req.query.category ? String(req.query.category).trim() : '';

    // sanitize category - only accept known categories
    if (selectedCategory && !CATEGORIES.includes(selectedCategory)) {
      selectedCategory = '';
    }

    // Build MongoDB filter
    const filter = {};
    if (q) {
      // case-insensitive partial match on name
      filter.name = { $regex: q, $options: 'i' };
    }
    if (selectedCategory) {
      filter.category = selectedCategory;
    }

    const products = await db.collection('products').find(filter).toArray();

    res.render('products', {
      title: 'Products - Chonccolate',
      products: products || [],
      user: req.session.user || null,
      success: req.query.success,
      error: req.query.error,
      // pass back search state so the form can show current values
      searchQuery: q,
      selectedCategory: selectedCategory,
      categories: CATEGORIES
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.render('products', {
      title: 'Products - Chonccolate',
      products: [],
      error: 'Failed to load products',
      user: req.session.user || null,
      searchQuery: '',
      selectedCategory: '',
      categories: CATEGORIES
    });
  }
});

// Show add product form (only for admins)
router.get('/add-product', (req, res) => {
    // Check if user is logged in and is an admin
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/users/login');
    }
    
    res.render('add-product', { 
        title: "Add New Product",
        user: req.session.user
    });
});

// Handle add product form submission with file upload
router.post('/add-product', upload.single('productImage'), async (req, res) => {
    // Check if user is logged in and is an admin
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }
    
    try {
        const { productName, description, price, category } = req.body;
        
        // Validate required fields
        const nameTrim = productName ? String(productName).trim() : '';
        const descTrim = description ? String(description).trim() : '';
        if (!nameTrim || nameTrim.length < 2) {
          return res.render('add-product', {
            title: 'Add New Product',
            error: 'Product name is required and must be at least 2 characters',
            user: req.session.user
          });
        }
        if (!descTrim || descTrim.length < 5) {
          return res.render('add-product', {
            title: 'Add New Product',
            error: 'Description is required and must be at least 5 characters',
            user: req.session.user
          });
        }
        if (!price) {
          return res.render('add-product', {
            title: 'Add New Product',
            error: 'Price is required',
            user: req.session.user
          });
        }
        // Convert price to number and validate
        const priceValue = parseFloat(price);
        if (isNaN(priceValue) || priceValue <= 0) {
          return res.render('add-product', {
            title: 'Add New Product',
            error: 'Please enter a valid price greater than 0',
            user: req.session.user
          });
        }
        if (!category || !CATEGORIES.includes(category)) {
          return res.render('add-product', {
            title: 'Add New Product',
            error: 'Please select a valid category',
            user: req.session.user
          });
        }
        
        const db = req.app.locals.client.db(req.app.locals.dbName);
        
        // Get the highest existing product ID and increment by 1
        const highestProduct = await db.collection('products')
            .find()
            .sort({ productId: -1 })
            .limit(1)
            .toArray();
            
        const nextId = highestProduct.length > 0 ? highestProduct[0].productId + 1 : 1;
        
        // Prepare image path if file was uploaded
        let imagePath = '/images/chonccolate.png'; // Default image
        if (req.file) {
            // Set the path relative to public folder for web access
            imagePath = '/uploads/' + req.file.filename;
        }
        
        const newProduct = {
          productId: nextId,
          name: nameTrim,
          description: descTrim,
          price: priceValue,
          category: category,
          image: imagePath,
          createdAt: new Date(),
          createdBy: req.session.user.userId
        };
        
        console.log('Attempting to insert product:', newProduct);
        
        // Insert the new product
        const result = await db.collection('products').insertOne(newProduct);
        
        console.log('Product insert result:', result);
        
        if (result.acknowledged) {
            // Redirect to products page with success message
            return res.redirect('/products?success=Product added successfully');
        } else {
            throw new Error('Failed to insert product');
        }
    } catch (err) {
        console.error('Error adding product:', err);
        res.render('add-product', {
            title: 'Add New Product',
            error: 'Failed to add product: ' + err.message,
            user: req.session.user
        });
    }
});

// Delete product (admin) — improved debug logging and safer error response
router.post('/:id/delete', async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
      console.warn('Unauthorized delete attempt', { ip: req.ip, params: req.params });
      return res.status(403).send('Unauthorized');
    }

    console.log('Delete route hit', { params: req.params, body: req.body, user: req.session.user?.email });

    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      console.warn('Invalid product id for delete', req.params);
      return res.redirect('/products?error=Invalid+product+ID');
    }

    const db = req.app.locals.client && req.app.locals.client.db && req.app.locals.client.db(req.app.locals.dbName);
    if (!db) {
      console.error('Database client not available on app.locals');
      return res.status(500).send('Database not initialized');
    }

    const product = await db.collection('products').findOne({ productId });
    if (!product) {
      console.warn('Product not found for delete', { productId });
      return res.redirect('/products?error=Product+not+found');
    }

    // Check if this product is referenced in any orders
    const ordersCount = await db.collection('orders').countDocuments({ 'items.productId': productId });
    if (ordersCount > 0) {
      console.log('Prevented delete: product used in orders', { productId, ordersCount });
      return res.redirect('/products?error=' + encodeURIComponent('Cannot delete this product because it is already used in one or more orders.'));
    }

    // Safe to delete image file (if any) and the product itself
    if (product.image && String(product.image).startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', 'public', product.image.replace(/^\//, ''));
      try {
        fs.unlinkSync(filePath);
        console.log('Deleted image file', filePath);
      } catch (fsErr) {
        if (fsErr.code !== 'ENOENT') console.warn('Failed to delete product image:', fsErr);
      }
    }

    const result = await db.collection('products').deleteOne({ productId });
    console.log('Product delete result:', result);

    return res.redirect('/products?success=Product+deleted+successfully');
  } catch (err) {
    console.error('Error deleting product:', err);
    // temporary: send error stack to browser to aid debugging
    return res.status(500).send('Server error during delete:\n' + (err.stack || err.message));
  }
});

// Show edit form (admin only)
router.get('/edit/:id', async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
      return res.redirect('/users/login');
    }

    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId)) return res.redirect('/products?error=Invalid+ID');

    const db = req.app.locals.client && req.app.locals.client.db && req.app.locals.client.db(req.app.locals.dbName);
    if (!db) {
      console.error('Database client not available on app.locals');
      return res.redirect('/products?error=Database+not+initialized');
    }

    const product = await db.collection('products').findOne({ productId });
    if (!product) return res.redirect('/products?error=Product+not+found');

    res.render('edit-product', {
      title: `Edit ${product.name}`,
      product,
      user: req.session.user,
      error: null,
      success: null
    });
  } catch (err) {
    console.error('Error loading edit form:', err);
    return res.status(500).render('edit-product', {
      title: 'Edit Product',
      error: 'Failed to load product: ' + (err.message || 'unknown error'),
      product: null,
      user: req.session?.user || null
    });
  }
});

// Handle edit submission (admin only) — improved error handling and user feedback
router.post('/edit/:id', upload.single('productImage'), async (req, res) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
      console.warn('Unauthorized edit attempt', { ip: req.ip, params: req.params });
      return res.redirect('/users/login');
    }

    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId)) return res.redirect('/products?error=Invalid+ID');

    const { productName, description, price, category } = req.body;
    const priceValue = parseFloat(price);
    const nameTrim = productName ? String(productName).trim() : '';
    const descTrim = description ? String(description).trim() : '';

    // Collect validation errors so we can show detailed feedback
    const validationErrors = [];
    if (!nameTrim || nameTrim.length < 2) validationErrors.push('Product name is required and must be at least 2 characters');
    if (!descTrim || descTrim.length < 5) validationErrors.push('Description is required and must be at least 5 characters');
    if (isNaN(priceValue) || priceValue <= 0) validationErrors.push('Price must be a number greater than 0');
    if (!category || !CATEGORIES.includes(category)) validationErrors.push('Please select a valid category');

    if (validationErrors.length > 0) {
      // Render the edit page with submitted values and the validation message(s)
      return res.status(400).render('edit-product', {
        title: `Edit ${nameTrim || 'Product'}`,
        error: validationErrors.join('. '),
        product: {
          productId,
          name: productName || '',
          description: description || '',
          price: price || '',
          category: category || ''
        },
        user: req.session.user || null,
        success: null
      });
    }

    const db = req.app.locals.client && req.app.locals.client.db && req.app.locals.client.db(req.app.locals.dbName);
    if (!db) {
      console.error('Database client not available on app.locals');
      return res.redirect(`/products/edit/${productId}?error=Database+not+initialized`);
    }

    const product = await db.collection('products').findOne({ productId });
    if (!product) return res.redirect(`/products?error=Product+not+found`);

    const update = {
      name: nameTrim,
      description: descTrim,
      price: priceValue,
      category: category,
      updatedAt: new Date()
    };

    if (req.file) {
      // delete old uploaded file if applicable
      if (product.image && String(product.image).startsWith('/uploads/')) {
        const oldFile = path.join(__dirname, '..', 'public', product.image.replace(/^\//, ''));
        try {
          fs.unlinkSync(oldFile);
        } catch (e) {
          if (e.code !== 'ENOENT') console.warn('Failed to delete old image:', e);
        }
      }
      update.image = '/uploads/' + req.file.filename;
    }

    const r = await db.collection('products').updateOne({ productId }, { $set: update });
    console.log('Product update result:', r);

    return res.redirect('/products?success=Product+updated+successfully');
  } catch (err) {
    console.error('Error updating product:', err);
    // render edit page with error message so you can see validation/DB issues
    const product = {
      productId: req.params.id,
      name: req.body?.productName || '',
      description: req.body?.description || '',
      price: req.body?.price || ''
    };
    return res.status(500).render('edit-product', {
      title: 'Edit Product',
      error: 'Failed to update product: ' + (err.message || 'unknown error'),
      product,
      user: req.session?.user || null
    });
  }
});

// Get a single product by ID
router.get('/:id', async (req, res) => {
    try {
        const productId = parseInt(req.params.id);
        if (isNaN(productId)) {
            return res.status(400).send('Invalid product ID');
        }
        
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const product = await db.collection('products').findOne({ productId: productId });
        
        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found',
                error: { status: 404 }
            });
        }
        
        res.render('product-detail', {
            title: product.name + ' - Chonccolate',
            product: product,
            user: req.session.user || null
        });
    } catch (err) {
        console.error('Error fetching product:', err);
        res.status(500).render('error', { 
            message: 'Error fetching product details',
            error: err
        });
    }
});

module.exports = router;