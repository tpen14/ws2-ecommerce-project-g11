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

// Product list route
router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const products = await db.collection('products').find().toArray();
        
        res.render('products', {
            title: 'Products - Chonccolate',
            products: products || [],
            user: req.session.user || null,
            success: req.query.success
        });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.render('products', {
            title: 'Products - Chonccolate',
            products: [],
            error: 'Failed to load products',
            user: req.session.user || null
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
        const { productName, description, price } = req.body;
        
        // Validate required fields
        if (!productName || !description || !price) {
            return res.render('add-product', {
                title: 'Add New Product',
                error: 'Please fill all required fields',
                user: req.session.user
            });
        }
        
        // Convert price to number and validate
        const priceValue = parseFloat(price);
        if (isNaN(priceValue) || priceValue <= 0) {
            return res.render('add-product', {
                title: 'Add New Product',
                error: 'Please enter a valid price',
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
        let imagePath = '/images/default-product.jpg'; // Default image
        if (req.file) {
            // Set the path relative to public folder for web access
            imagePath = '/uploads/' + req.file.filename;
        }
        
        const newProduct = {
            productId: nextId,
            name: productName,
            description: description,
            price: priceValue,
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